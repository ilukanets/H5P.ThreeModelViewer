const MiniCSSExtractPlugin = require('mini-css-extract-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');

module.exports = {
  mode: 'production',
  module: {
    rules: [
      {
        test: /\.js$/,
        use: 'babel-loader'
      },
      {
        test: /\.css$/,
        use: [
          {
            loader: MiniCSSExtractPlugin.loader,
            options: {
              publicPath: ''
            }
          },
          'css-loader'
        ]
      },
      {
        test: /\.(vert|frag)$/i,
        use: 'raw-loader',
      }
    ]
  },
  optimization: {
    minimize: true,
    minimizer: [`...`, new CssMinimizerPlugin()]
  },
  plugins: [
    new MiniCSSExtractPlugin()
  ]
}
