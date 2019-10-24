const Component = require('./src/lib/Component');
const Builder = require('./src/lib/Builder');

Error.stackTraceLimit = Infinity;

const index = new Component('src/sass', __dirname, {
  isIndex: true
});

const builder = new Builder();


index.build(builder).then(result => console.log(result)).catch(err => console.error(err));