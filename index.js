const Component = require('./src/lib/Component');

const index = new Component('src/sass', __dirname, {
  isIndex: true
});

index.build().then(result => console.log(result)).catch(err => console.error(err));