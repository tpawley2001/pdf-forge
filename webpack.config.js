const path = require('path');
const fs = require('fs');
const HtmlWebpackPlugin = require('html-webpack-plugin');

class CopyOcrAssetsPlugin {
  apply(compiler) {
    compiler.hooks.afterEmit.tap('CopyOcrAssetsPlugin', () => {
      const out = compiler.options.output.path;
      const copyFile = (from, to) => {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
      };
      const copyDir = (from, to) => {
        fs.mkdirSync(to, { recursive: true });
        for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
          const src = path.join(from, entry.name);
          const dst = path.join(to, entry.name);
          if (entry.isDirectory()) copyDir(src, dst);
          else copyFile(src, dst);
        }
      };

      copyFile(
        path.resolve(__dirname, 'node_modules/tesseract.js/dist/worker.min.js'),
        path.join(out, 'ocr/worker.min.js'),
      );
      copyDir(
        path.resolve(__dirname, 'node_modules/tesseract.js-core'),
        path.join(out, 'ocr/core'),
      );
      copyFile(
        path.resolve(__dirname, 'node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz'),
        path.join(out, 'ocr/lang/eng.traineddata.gz'),
      );
      // PDFium (paragraph text editing) — fetched by src/pdf/PdfiumEngine.js
      copyFile(
        require.resolve('@embedpdf/pdfium/pdfium.wasm'),
        path.join(out, 'pdfium/pdfium.wasm'),
      );
    });
  }
}

module.exports = {
  target: 'web',
  mode: process.env.NODE_ENV || 'development',
  entry: './src/renderer/index.jsx',
  output: {
    path: path.resolve(__dirname, 'dist-renderer'),
    filename: 'renderer.js',
    publicPath: './',
  },
  devServer: {
    port: 9000,
    hot: true,
    static: { directory: path.resolve(__dirname, 'dist-renderer') },
  },
  resolve: {
    extensions: ['.js', '.jsx', '.json'],
    fallback: {
      fs: false, path: false, crypto: false,
      stream: false, util: false, assert: false,
      http: false, https: false, url: false, zlib: false,
    },
  },
  module: {
    rules: [
      {
        test: /pdf\.worker(\.min)?\.js$/,
        type: 'asset/resource',
        generator: { filename: '[name][ext]' },
      },
      {
        // We fetch pdfium.wasm ourselves; don't let webpack emit a second copy
        // for the package's `new URL('pdfium.wasm', import.meta.url)` default.
        test: /@embedpdf[\\/]pdfium[\\/]dist[\\/].*\.js$/,
        parser: { url: false },
      },
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              '@babel/preset-env',
              ['@babel/preset-react', { runtime: 'automatic' }],
            ],
          },
        },
      },
      { test: /\.css$/, use: ['style-loader', 'css-loader'] },
      { test: /\.(png|jpg|jpeg|gif|svg)$/, type: 'asset/resource' },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/renderer/index.html',
      filename: 'index.html',
      inject: 'body',
    }),
    new CopyOcrAssetsPlugin(),
  ],
  devtool: 'source-map',
};
