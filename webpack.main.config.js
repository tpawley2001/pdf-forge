const path = require('path');
const fs = require('fs');

class CopyQpdfWasmPlugin {
  apply(compiler) {
    compiler.hooks.afterEmit.tap('CopyQpdfWasmPlugin', () => {
      fs.copyFileSync(
        require.resolve('@neslinesli93/qpdf-wasm/dist/qpdf.wasm'),
        path.join(compiler.options.output.path, 'qpdf.wasm'),
      );
    });
  }
}

/**
 * Bundles main-process modules that need npm dependencies (digital
 * signatures) into dist-main/, because the packaged app ships without
 * node_modules (see electron-builder.yml).
 */
module.exports = {
  target: 'electron28.3-main',
  mode: 'production',
  entry: { signing: './src/main/signing.js', pdfTools: './src/main/pdfTools.js' },
  node: { __dirname: false }, // pdfTools finds qpdf.wasm next to the bundle
  plugins: [new CopyQpdfWasmPlugin()],
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
