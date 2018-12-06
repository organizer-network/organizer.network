const yaml = require('js-yaml');
const fs = require('fs');

const instance_yml = fs.readFileSync(`${__dirname}/../instance.yml`, 'utf8');
const instance = yaml.safeLoad(instance_yml);

console.log('loading instance');

module.exports = instance;
