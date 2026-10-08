const path = require('path');

/**
 * Bundles main-process modules that need npm dependencies (digital
 * signatures) into dist-main/, because the packaged app ships without
 * node_modules (see electron-builder.yml).
 */
module.exports = {
  target: 'electron28.3-main',
  mode: 'production',
  entry: { signing: './src/main/signing.js' },
  output: {
    path: path.resolve(__dirname, 'dist-main'),
    filename: '[name].js',
    library: { type: 'commonjs2' },
  },
  optimization: { minimize: false },
  externals: { electron: 'commonjs electron' },
  ignoreWarnings: [/Can't resolve 'debug'/, /Critical dependency/],
  devtool: false,
};
