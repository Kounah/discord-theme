const sass = require('node-sass');
const path = require('path');
const fs = require('fs-extra');

let options = fs
  .readdirSync(path.join(__dirname, './src/sass'))
  .map(f => path.join(__dirname, './src/sass'))