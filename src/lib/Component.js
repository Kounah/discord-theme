const path = require('path');
const fs = require('fs-extra');
const YAML = require('yaml');

/**@typedef {('module'|'content')} ComponentType */
/**
 * @typedef {Object} Variable
 * @prop {string} name
 * @prop {string} description
 * @prop {string} format
 * @prop {any} default
 * @prop {any} value
 */

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

    if(typeof comp === 'undefined') {
      this.path = dir;
    }

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
          this.content = fs.readFileSync(this.path).toString('utf-8');
        }
      } else throw(new Error('Component does not exist: \'' + this.path + '\''));
    } else {
      this._properties = props;
      if(Array.isArray(this._properties.components)) {
        this.type = 'module';
      } else this.type = 'content';
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
      this.selected = typeof this._properties.selected === 'number'
        ? this._properties.selected
        : 0;

      /**@type {Array.<Variable>} */
      this.variables = this._properties.variables;

      if(Array.isArray(this._properties.components)) {
        /**@type {Array.<Component>} */
        this.components = this._properties.components.map(comp => {
          if(typeof comp.$ref === 'string') 
            return new Component(comp.$ref, this.path, comp);
          
          return new Component(undefined, this.path, comp)
        }).sort((a, b) => a.order - b.order);
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
      return this.variables.map(v => {
        let val = typeof v.value !== 'undefined' ? v.value : v.default;
        if(typeof v.format === 'string')
          val = v.format.split('$').join(val);
        return `$${v.name}: ${val};`;
      }).join('\n');
    } else return '';
  }

  async data() {
    let s = `${this.vars()}\n`
      + this.content;

    return s;
  }

  /**
   * @param {import('./Builder')} builder
   */
  async build(builder) {
    return await builder.add(this);
  }
}

module.exports = Component;