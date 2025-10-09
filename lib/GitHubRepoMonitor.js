import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { load as yamlParse } from 'js-yaml';
import { createHash } from 'crypto';
import AdmZip from 'adm-zip';
import logger from './logger.js';

const { readFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } = fs;

export class GitHubRepoMonitor {
  constructor(
    repoOwner,
    repoName,
    folderPath,
    localBasePath = './EMC',
    configFileName = 'config.yaml',
    pollInterval = 60000
  ) {
    this.repoOwner = repoOwner;
    this.repoName = repoName;
    this.folderPath = folderPath;
    this.localBasePath = localBasePath;
    this.configFileName = configFileName;
    this.pollInterval = pollInterval;
    this.lastDownloadedCommit = null;
    this.logger = logger || console;
  }

  async downloadAndExtract(ref = 'main') {
    const zipUrl = `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/zipball/${ref}`;
    this.logger.info(`Downloading repo archive from ${zipUrl}`);
    try {
      const response = await axios.get(zipUrl, {
        responseType: 'arraybuffer',
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'Authorization': process.env.GITHUB_TOKEN ? `Bearer ${process.env.GITHUB_TOKEN}` : undefined
        },
        maxRedirects: 5,
      });
      const zipBuffer = Buffer.from(response.data);
      const zip = new AdmZip(zipBuffer);
      const zipEntries = zip.getEntries();
      const basePrefix = zipEntries[0].entryName.split('/')[0];
      const targetPrefix = `${basePrefix}/${this.folderPath}/`;
      this.logger.info(`Extracting entries under prefix ${targetPrefix}`);
      const localFolderRoot = path.join(this.localBasePath, ref);
      if (!existsSync(localFolderRoot)) {
        mkdirSync(localFolderRoot, { recursive: true });
      }
      for (const entry of zipEntries) {
        const name = entry.entryName;
        if (!name.startsWith(targetPrefix)) continue;
        const relPath = name.substring(basePrefix.length + 1);
        if (!relPath) continue;
        const targetPath = path.join(this.localBasePath, ref, relPath);
        if (entry.isDirectory) {
          mkdirSync(targetPath, { recursive: true });
        } else {
          const parent = path.dirname(targetPath);
          if (!existsSync(parent)) {
            mkdirSync(parent, { recursive: true });
          }
          writeFileSync(targetPath, entry.getData());
        }
      }
      this.logger.info(`Extraction complete for ${this.folderPath} under ${localFolderRoot}`);
    } catch (error) {
      this.logger.error(`Download failed: ${error.response?.status} ${error.message}`);
      throw error;
    }
  }

  async getSubfolderCommitInfo() {
    try {
      const response = await axios.get(
        `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/commits`,
        {
          params: { path: this.folderPath, per_page: 100 },
          headers: {
            'Accept': 'application/vnd.github.v3+json',
            'Authorization': process.env.GITHUB_TOKEN ? `Bearer ${process.env.GITHUB_TOKEN}` : undefined
          }
        }
      );
      this.logger.info(`Fetched ${response.data.length} commits for ${this.folderPath}`);
      return response.data.map((c) => {
        const folderName = c.sha;
        return { sha: c.sha, date: c.commit.author.date, message: c.commit.message, folderName };
      });
    } catch (error) {
      this.logger.error(`Failed to fetch subfolder commit info: ${error.response?.status} ${error.message}`);
      throw error;
    }
  }

  getMostRecentSubfolder(commitInfos) {
    const localFolders = existsSync(this.localBasePath)
      ? readdirSync(this.localBasePath).filter((f) => !f.startsWith('.'))
      : [];
    return commitInfos.reduce((recent, info) => {
      if (localFolders.includes(info.folderName)) {
        const isMoreRecent = !recent || new Date(info.date) > new Date(recent.date);
        return isMoreRecent ? info : recent;
      }
      return recent;
    }, null);
  }

  async ensureLocalRepo() {
    const commitInfos = await this.getSubfolderCommitInfo();
    this.logger.info(`Found ${commitInfos.length} commits for ${this.folderPath}`);
    if (commitInfos.length === 0) {
      throw new Error(`No commits found for folder ${this.folderPath}. Verify the folder exists in the repository.`);
    }
    const mostRecent = this.getMostRecentSubfolder(commitInfos);
    if (!mostRecent) {
      const top = commitInfos[0];
      this.logger.info(`No local folder found for ${this.folderPath}. Downloading for commit ${top.sha}`);
      await this.downloadAndExtract(top.sha);
      this.lastDownloadedCommit = top.sha;
      return commitInfos;
    } else {
      this.lastDownloadedCommit = mostRecent.sha;
      return commitInfos;
    }
  }

  loadConfigFromFile(filePath) {
    try {
      const configFile = readFileSync(filePath, 'utf8');
      const config = yamlParse(configFile);
      // Validate required fields for a single sportsbook config
      if (!config.name || !config.base_url) {
        throw new Error("Invalid config: 'name' and 'base_url' are required");
      }
      return config;
    } catch (error) {
      this.logger.error(`Failed to load config from ${filePath}: ${error.message}`);
      throw error;
    }
  }

  async getLatestConfigDetails() {
    const commitInfos = await this.ensureLocalRepo();
    const mostRecent = this.getMostRecentSubfolder(commitInfos);
    if (!mostRecent) {
      throw new Error('No recent subfolder found');
    }
    const folderPath = path.join(this.localBasePath, mostRecent.folderName, this.folderPath);
    if (!existsSync(folderPath)) {
      throw new Error(`Folder ${folderPath} not found locally`);
    }
    const configs = [];
    const subdirs = readdirSync(folderPath).filter((dir) =>
      existsSync(path.join(folderPath, dir, this.configFileName))
    );
    console.log('Subdirectories found:', subdirs);

    for (const subdir of subdirs) {
      const configPath = path.join(folderPath, subdir, this.configFileName);
      const fileContent = readFileSync(configPath, 'utf8');
      const hash = createHash('sha256').update(fileContent).digest('hex');
      try {
        const config = this.loadConfigFromFile(configPath);
        configs.push({
          path: configPath,
          config,
          hash,
          folder: subdir,
        });
      } catch (error) {
        this.logger.warn(`Skipping invalid config in ${configPath}: ${error.message}`);
      }
    }
    if (configs.length === 0) {
      throw new Error(`No valid ${this.configFileName} files found in subdirectories of ${folderPath}`);
    }
    return configs;
  }

  getFileHash(filePath) {
    const file = readFileSync(filePath, 'utf8');
    return createHash('sha256').update(file).digest('hex');
  }

  async startMonitoring() {
    try {
      let currentConfigs = await this.getLatestConfigDetails();
      this.logger.info(`Initial configs loaded from ${currentConfigs.length} bookies`);
      setInterval(async () => {
        try {
          const newConfigs = await this.getLatestConfigDetails();
          if (
            newConfigs.length !== currentConfigs.length ||
            newConfigs.some((nc, i) => nc.hash !== currentConfigs[i]?.hash)
          ) {
            this.logger.info(`Detected config changes in ${newConfigs.length} bookies`);
            if (newConfigs[0].folder !== this.lastDownloadedCommit) {
              this.logger.info(`New commit detected: ${newConfigs[0].folder}. Downloading...`);
              await this.downloadAndExtract(newConfigs[0].folder);
              this.lastDownloadedCommit = newConfigs[0].folder;
            }
            currentConfigs = newConfigs;
          } else {
            this.logger.info('No config changes detected');
          }
        } catch (error) {
          this.logger.error(`Error during monitoring: ${error.message}`);
        }
      }, this.pollInterval);
    } catch (error) {
      this.logger.error(`Error during initial monitoring setup: ${error.message}`);
    }
  }
}
