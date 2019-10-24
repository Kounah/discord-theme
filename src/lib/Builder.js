const sass = require('node-sass');
const os = require('os');
const fs = require('fs-extra');
const path = require('path');
const Component = require('./Component');

/**
 * @callback BuilderQueueItemCallback
 * @param {Error} err
 * @param {string} result
 * 
 * @typedef {Object} BuilderQueueItem
 * @prop {Component} comp
 * @prop {BuilderQueueItemCallback} cb
 */

const tmpdir = path.join(os.tmpdir(), 'discord-theme');
const builddir = path.join(tmpdir, 'build');

if(fs.existsSync(tmpdir)) {
  fs.mkdirpSync(tmpdir);
}

if(fs.existsSync(builddir)) {
  fs.removeSync(builddir);
}

class Builder {
  constructor() {
    /**@type {Array.<BuilderQueueItem>} */
    this.queue = [];
    /**@type {Component} */
    this.index = undefined;
    /**@type {Array.<string>} */
    this.imports = [];

    this.add = this.add.bind(this);
    this.build = this.build.bind(this);
    this.next = this.next.bind(this);

    this.next();
  }

  async build(comp) {
    
    if(typeof comp === 'object'
    && comp !== null
    && comp instanceof Component) {
      if(typeof this.index === 'undefined' && !comp.isIndex)
        throw new Error('cannot start building on a non index component');

      if(!comp.optional || !comp.skipBuild) {
        if(comp.type === 'module') {
          if(comp.isIndex) {
            this.index = comp;
            this.imports = [];
            await new Promise((resolve, reject) => {
              fs.mkdirp(builddir, (err) => {
                if(err) return reject(err);
                resolve();
              })
            })
          } else await new Promise((resolve, reject) => {
            fs.mkdirp(path.join(builddir, path.relative(this.index.path, comp.path)), (err) => {
              if(err) return reject(err);
              resolve(err);
            });
          })

          // copy dependencies
          if(Array.isArray(comp.$dependencies)) {
            await Promise.all(comp.$dependencies.map(dep => new Promise((resolve, reject) => {
              let p = path.join(builddir, path.relative(this.index.path, dep));
              let par = path.parse(p);
              fs.mkdirp(par.dir, (err) => {
                if(err) return reject(err);
                fs.copyFile(dep, p, (err) => {
                  if(err) return reject(err);
                  resolve();
                })
              })
            })));
          }

          if(comp.oneof) {
            await this.build(comp.components[comp.selected]);
          } else {
            if(Array.isArray(comp.components)) {
              await Promise.all(comp.components.map(c => this.build(c)));
            }
          }

          if(comp.isIndex) {
            let indexData = this.imports
            .map(imp => {
              return `@import "${path.posix.join(...imp.split(path.sep)).split('"').join('\\"')}";`;
            }).join('\n');
            let indexFile = path.join(builddir, 'index.scss');

            await new Promise((resolve, reject) => {
              fs.writeFile(indexFile, indexData, (err) => {
                if(err) return reject(err);
                resolve();
              })
            });

            let css = await new Promise((resolve, reject) => {
              sass.render({
                file: indexFile
              }, (err, result) => {
                if(err) return reject(err);
                resolve(result.css.toString('utf-8'));
              });
            });

            this.index = undefined;

            return css;
          }
        } else if(comp.type === 'content') {
          await new Promise((resolve, reject) => {
            fs.mkdirp(path.join(builddir, path.relative(this.index.path, path.parse(comp.path).dir)), (err) => {
              if(err) return reject(err);
              resolve();
            })
          });
          await new Promise(async (resolve, reject) => {
            let p = path.join(builddir, path.relative(this.index.path, comp.path));
            fs.writeFile(p
            , await comp.data()
            , (err) => {
              if(err) return reject(err);
              resolve();
            })
          });
          this.imports.push(path.relative(this.index.path, comp.path));
        }
      }
    }
  }

  async cleanup() {
    return await new Promise(resolve => {
      fs.exists(builddir, (exists) => {
        if(exists) fs.remove(builddir, (err) => {
          if(err) return console.error(err);
          resolve();
        });
      });
    })
  }

  next() {
    if(this.queue.length > 0) {
      let qi = this.queue.shift();
      this.build(qi.comp)
      .then(result => {
        qi.cb(null, result);
        this.cleanup().then(this.next())
      })
      .catch(err => {
        console.error(err)
        qi.cb(err, null);
        this.cleanup().then(this.next())
      })
    } else {
      setTimeout(this.next, 500);
    }
  }

  add(comp) {
    return new Promise((resolve, reject) => this.queue.push({
      comp,
      cb: (err, result) => {
        if(err) return reject(err);
        resolve(result);
      }
    }));
  }
}

module.exports = Builder;