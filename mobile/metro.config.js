const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Ensure .cjs files resolve (needed for some Solana deps)
config.resolver.sourceExts.push("cjs");

module.exports = config;
