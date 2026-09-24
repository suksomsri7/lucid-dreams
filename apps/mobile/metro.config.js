// Metro config สำหรับ monorepo (pnpm + node-linker=hoisted)
// ต้องเฝ้าโฟลเดอร์รากด้วย ไม่งั้นแก้ packages/engine แล้วแอปไม่รู้
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
