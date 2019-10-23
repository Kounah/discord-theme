const sass = require('node-sass');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const YAML = require('yaml');

/**@typedef {('module'|'content')} ComponentType */
/**
 * @typedef {Object} Variable
 * @prop {string} name
 * @prop {any} default
 * @prop {any} value
 */

/**
 * @callback BuilderQueueItemCallback
 * @param {Error} err
 * @param {string} result
 * 
 * @typedef {Object} BuilderQueueItem
 * @prop {Component} comp
 * @prop {BuilderQueueItemCallback} cb
 */

const tmpdir = path.join(os.tmpdir(), 'discord-theme', 'build');
const tmpdirsrc = path.join(tmpdir, 'src');

fs.mkdirpSync(tmpdir);

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
              fs.mkdirp(tmpdirsrc, (err) => {
                if(err) return reject(err);
                resolve();
              })
            })
          } else await new Promise((resolve, reject) => {
            fs.mkdirp(path.join(tmpdirsrc, path.relative(this.index.path, comp.path)), (err) => {
              if(err) return reject(err);
              resolve(err);
            });
          })

          // copy dependencies
          if(Array.isArray(comp.$dependencies)) {
            await Promise.all(comp.$dependencies.map(dep => new Promise((resolve, reject) => {
              let p = path.join(tmpdirsrc, path.relative(this.index.path, dep));
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
          }

          if(Array.isArray(comp.components)) {
            await Promise.all(comp.components.map(c => this.build(c)));
          }


          if(comp.isIndex) {
            let indexData = this.imports
            .map(imp => {
              return `@import "${imp.split('"').join('\\"')}";`;
            }).join('\n');
            let indexFile = path.join(tmpdirsrc, 'index.scss');

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

            await new Promise((resolve, reject) => fs.remove(tmpdirsrc, (err) => {
              if(err) return reject(err);
              resolve();
            }))

            this.index = undefined;

            return css;
          }
        } else if(comp.type === 'content') {
          await new Promise((resolve, reject) => {
            fs.mkdirp(path.join(tmpdirsrc, path.relative(this.index.path, comp.path)), (err) => {
              if(err) return reject(err);
              resolve();
            })
          });
          await new Promise(async (resolve, reject) => {
            fs.writeFile(path.join(tmpdirsrc, path.relative(this.index.path, comp.path))
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

  next() {
    if(this.queue.length > 0) {
      let qi = this.queue.shift();
      this.build(qi.comp)
      .then(result => qi.cb(null, result))
      .catch(err => qi.cb(err, null))
      .finally(() => this.next());
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

const builder = new Builder();

class Component {
  /**
   * creates a new component
   * @param {string} comp
   * @param {string} dir
   * @param {Component} props 
   */
  constructor(comp, dir, props) {
    this.path = (typeof props === 'object' && props !== null && typeof props.path === 'string')
      ? props.path
      : path.join(dir, String(comp));

    /**@type {Component} */
    this._properties = typeof props === 'object'
      ? props
      : {};

    this._name = comp;
    this._dir = dir;

    /**@type {ComponentType} */
    this.type;

    if(comp !== undefined) {
      if(fs.existsSync(this.path)) {
        let stat = fs.statSync(this.path);

        if(stat.isDirectory()) {
          let componentPropertiesPath = path.join(this.path, 'properties.yaml');
          if(fs.existsSync(componentPropertiesPath)
          && fs.statSync(componentPropertiesPath).isFile()) {
            this.type = 'module';

            /**
             * is only set if the component is a directory with a `properties.yaml` file
             * @type {Component}
             */
            let properties =YAML.parse(fs.readFileSync(componentPropertiesPath).toString('utf-8'));
            Object.getOwnPropertyNames(properties).forEach(propertyName => {
              this._properties[propertyName] = properties[propertyName];
            });
          }
        }

        if(stat.isFile()) {
          this.type = 'content';
          this.content = fs.readFileSync(this.path);
        }
      } else throw(new Error('Component does not exist: \'' + this.path + '\''));
    }

    if(typeof this._properties === 'object' && this._properties !== null) {
      /**
       * component name
       * @type {string}
       */
      this.name = String(this._properties.name);
  
      /**
       * component description
       * @type {string}
       */
      this.description = String(this._properties.description);
  
      /**
       * build and customization order
       * @type {number}
       */
      this.order = typeof this._properties.order !== 'undefined'
        ? Number(this._properties.order)
        : 0;

      /**
       * is this component optional (can the user choose to skip it in build)
       * @type {boolean}
       */
      this.optional = Boolean(this._properties.optional);
      /**
       * will decide if this components build is skipped (if optional === true)
       * @type {boolean}
       */
      this.skipBuild = true;

      /**@type {boolean} */
      this.isIndex = Boolean(this._properties.isIndex);

      /**@type {string}*/
      this.$ref;

      /**@type {boolean} */
      this.oneof = Boolean(this._properties.oneof);
      /**@type {number} */
      this.selected = Number(this._properties.selected);

      /**@type {Array.<Variable>} */
      this.variables = this._properties.variables;

      if(Array.isArray(this._properties.components)) {
        /**@type {Array.<Component>} */
        this.components = this._properties.components.map(comp => {
          if(typeof comp.$ref === 'string') 
            return new Component(comp.$ref, this.path, comp);
        }).sort((a, b) => b.order - a.order);
      }

      if(Array.isArray(this._properties.$dependencies)) {
        this.$dependencies = this._properties.$dependencies
        .filter(dep => !path.isAbsolute(dep))
        .map(dep => {
          switch(this.type) {
            case 'module':
              return path.join(this.path, dep);
            case 'content':
              return path.join(path.parse(this.path).dir, dep);
          }
        })
      }
    }

    this.data = this.data.bind(this);
    this.vars = this.vars.bind(this);
    this.build = this.build.bind(this);
  }

  vars() {
    if(Array.isArray(this.variables)) {
      return this.variables.map(v => `$${v.name}: ${typeof v.value != undefined ? v.value : v.default}`).join('\n');
    }
  }

  async data() {
    let s = `/* Component: '${this.name}' */\n`
      + `/* Variables */\n${this.vars()}\n`
      + `/* Style */\n`;
    
    s += await new Promise((resolve, reject) => {
      fs.readFile(this.path, (err, data) => {
        if(err) return reject(err);
        resolve(data.toString('utf-8'));
      });
    });

    return s;
  }

  async build() {
    return await builder.add(this);
  }
}

builder.next();

module.exports = Component;