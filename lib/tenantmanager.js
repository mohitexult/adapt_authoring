/**
 * Tenant management module
 */

var util = require('util'),
    database = require('./database'),
    logger = require('./logger'),
    fs = require('fs'),
    path = require('path'),
    ncp = require('ncp'),
    mkdirp = require('mkdirp'),
    frameworkhelper = require('./frameworkhelper'),
    configuration = require('./configuration');

// Constants
var MODNAME = 'tenantmanager';
var WAITFOR = 'database';
var FRAMEWORK_DIR = 'adapt_framework';

// custom errors
function TenantCreateError (message) {
  this.name = 'TenantCreateError';
  this.message = message || 'Tenant create error';
}

util.inherits(TenantCreateError, Error);

function DuplicateTenantError (message) {
  this.name = 'DuplicateTenantError';
  this.message = message || 'Tenant already exists';
}

util.inherits(DuplicateTenantError, Error);

exports = module.exports = {

  // expose errors
  errors: {
    'TenantCreateError': TenantCreateError,
    'DuplicateTenantError': DuplicateTenantError
  },

  /**
   * preload function sets up event listener for startup events
   *
   * @param {object} app - the AdaptBuilder instance
   * @return {object} preloader - an AdaptBuilder ModulePreloader
   */

  preload : function (app) {
    var preloader = new app.ModulePreloader(app, MODNAME, { events:this.preloadHandle(app,this) });
    return preloader;
  },

  /**
   * Event handler for preload events
   *
   * @param {object} app - Server instance
   * @param {object} instance - Instance of this module
   * @return {object} hash map of events and handlers
   */

  preloadHandle : function (app, instance) {
    return {

      preload : function () {
        var preloader = this;
        preloader.emit('preloadChange', MODNAME, app.preloadConstants.WAITING);
      },

      moduleLoaded : function (modloaded) {
        var preloader = this;

        // is the module that loaded this modules requirement
        if (modloaded === WAITFOR) {
          preloader.emit('preloadChange', MODNAME, app.preloadConstants.LOADING);

          app.tenantmanager = instance;
          // set up routes
          var rest = require('./rest');
          var self = instance;

          // create tenant
          rest.post('/tenant', function (req, res, next) {
            var tenantData = req.body;

            self.createTenant(tenantData, function (err, result) {
              if (err) {
                return next(err);
              }

              res.statusCode = 200;
              return res.json(result);
            });
          });

          // enumerate tenants
          rest.get('/tenant', function (req, res, next) {
            var search = req.query;
            var options = req.query.operators || {};

            self.retrieveTenants(search, options, function (err, results) {
              if (err) {
                return next(err);
              }

              res.statusCode = 200;
              return res.json(results);
            });
          });

          // single tenant
          rest.get('/tenant/:id', function (req, res, next) {
            var id = req.params.id;
            var options = req.query.operators || {};

            if (!id || 'string' !== typeof id) {
              res.statusCode = 400;
              return res.json({ success: false, message: 'id param must be an objectid' });
            }

            self.retrieveTenant({ _id: id }, options, function (err, tenantRec) {
              if (err) {
                return next(err);
              }

              res.statusCode = 200;
              return res.json(tenantRec);
            });
          });

          // update a single tenant
          rest.put('/tenant/:id', function (req, res, next) {
            var id = req.params.id;
            var delta = req.body;

            self.updateTenant({ _id: id }, delta, function (err, result) {
              if (err) {
                return next(err);
              }

              // update was successful
              res.statusCode = 200;
              return res.json(result);
            });
          });

          // delete (softly) a tenant
          rest.delete('/tenant/:id', function (req, res, next) {
            var id = req.params.id;

            self.destroyTenant(id, function (err) {
              if (err) {
                return next(err);
              }

              res.statusCode = 200;
              return res.json({ success: true, message: 'successfully deleted tenant!' });
            });
          });

          app.on('serverStarted', self.loadDatabaseConfigs.bind(self));
          preloader.emit('preloadChange', MODNAME, app.preloadConstants.COMPLETE);
        }
      }
    };
  },

  /**
   * Creates the working folders required by a new tenant to preview
   * or publish courses
   * @param {object} tenant - a fully defined tenant object
   * @param {function} callback - function of the form function (error, tenant)
   */
  createTenantFilesystem: function(tenant, callback) {

    function copyFramework(callback) {
      logger.log('info', 'Copying Adapt framework into place for new tenant');
      ncp(path.join(configuration.serverRoot, FRAMEWORK_DIR), path.join(configuration.tempDir, tenant._id.toString(), FRAMEWORK_DIR), function (err) {
        if (err) {
          logger.log('error', err);
          return callback(err);
        } else {
          return callback(null);
        }
      });
    };

    mkdirp(path.join(configuration.tempDir, tenant._id.toString()), function (err) {
        if (err) {
          logger.log('error', err);
          return callback(err);
        }

        // Check that framework exists
        fs.exists(path.join(configuration.serverRoot, FRAMEWORK_DIR), function(exists) {
          if (!exists) {
            logger.log('info', 'Framework does not exist');
            frameworkhelper.cloneFramework(null, function(err, result) {
              if (err) {
                logger.log('fatal', 'Error cloning framework', err);
                return callback(err);
              }
              else {
                return copyFramework(callback)
              }
            });
          } else {
            return copyFramework(callback);
          }
        });
      });
  },

  /**
   * creates a tenant
   *
   * @param {object} tenant - a fully defined tenant object
   * @param {function} callback - function of the form function (error, tenant)
   */
  createTenant: function (tenant, callback) {
    var self = this;

    database.getDatabase(function(err, db){

      // name is our primary unique identifier
      if (!tenant.name || 'string' !== typeof tenant.name) {
        return callback(new TenantCreateError('tenant name is required!'));
      }

      // create db details if not supplied
      if (!tenant.database) {
        tenant.database = {
          dbName: tenant.name.replace(/[^A-Za-z0-9-_]+/, ''), // is this ok, ed?
          dbHost: configuration.getConfig('dbHost'),
          dbUser: configuration.getConfig('dbUser'),
          dbPass: configuration.getConfig('dbPass'),
          dbPort: configuration.getConfig('dbPort')
        };
      }

      // verify the tenant name
      db.retrieve('tenant', { name: tenant.name }, function (error, results) {
        if (error) {
          return callback(error);
        }

        if (results && results.length) {
          // tenant exists
          return callback(new DuplicateTenantError());
        }

        db.create('tenant', tenant, function (error, result) {
          // wrap the callback since we might want to alter the result
          if (error) {
            logger.log('error', 'Failed to create tenant: ', tenant);
            return callback(error);
          }

          // memoize
          self._dbConfigs[result.name] = result.database;
          self.createTenantFilesystem(result, function(error) {
            if (error) {
              return callback(error);
            }

            // broadcast tenant creation event
            app.emit('tenant:created', result);

            return callback(null, result);
          });
        });
      });
    }, configuration.getConfig('dbName'));
  },

  /**
   * retrieves tenants matching the search
   *
   * @param {object} search - fields of tenant that should be matched
   * @param {object} options - operators, populators etc
   * @param {function} callback - function of the form function (error, tenants)
   */

  retrieveTenants: function (search, options, callback) {
    // shuffle params
    if ('function' === typeof options) {
      callback = options;
      options = {};
    }

    database.getDatabase(function(err, db){
      // delegate to db retrieve method
      db.retrieve('tenant', search, options, callback);
    }, configuration.getConfig('dbName'));
  },

  /**
   * retrieves a single tenant
   *
   * @param {object} search - fields to match: should use 'name' or '_id' which are unique
   * @param {object} options - query, operators etc
   * @param {function} callback - function of the form function (error, tenant)
   */

  retrieveTenant: function (search, options, callback) {
    // shuffle params
    if ('function' === typeof options) {
      callback = options;
      options = {};
    }

    database.getDatabase(function(err, db) {
      db.retrieve('tenant', search, options, function (error, results) {
        if (error) {
          return callback(error);
        }

        if (results && results.length === 1) {
            // we only want to retrieve a single tenant, so we send an error if we get multiples
            return callback(null, results[0]);
        }

        return callback(null, false);
      });
     }, configuration.getConfig('dbName'));
  },

  /**
   * updates a single tenant
   *
   * @param {object} search - fields to match: should use 'name' or '_id' which are unique
   * @param {object} update - fields to change and their values
   * @param {function} callback - function of the form function (error, tenant)
   */

  updateTenant: function (search, update, callback) {
    var self = this;
    database.getDatabase(function(err, db){
      // only execute if we have a single matching record
      self.retrieveTenant(search, function (error, result) {
        if (error) {
          return callback(error);
        }

        if (result) {
          db.update('tenant', search, update, function(error) {
            if (error) {
              return callback(error);
            }

            // Re-fetch the tenant
            self.retrieveTenant(search, function(error, result) {
              if (error) {
                return callback(error);
              }

              // IMPORTANT - Refresh the _dbConfigs
              self._dbConfigs[result.name] = result.database;

              return callback(null, result);
            });

          });
        } else {
          return callback(new Error('No matching tenant record found'));
        }

      });
    }, configuration.getConfig('dbName'));
  },

  /**
   * delete a tenant (soft delete, just updates the deleted flag)
   *
   * @param {string} tenantId - must match a tenant in db
   * @param {function} callback - function of the form function (error)
   */

  destroyTenant: function (tenantId, callback) {
    var self = this;
    database.getDatabase(function(err, db){
      // confirm the tenant exists and is there is only one of them
      self.retrieveTenant({ _id: tenantId }, function (error, results) {
        if (error) {
          return callback(error);
        }

        if (results && results.length === 1) {
          return self.updateTenant({ '_id': results[0]._id }, { _isDeleted: true }, callback);
        }

        return callback(new Error('No matching tenant record found'));
      });
    }, configuration.getConfig('dbName'));
  },

  /**
   * deletes a single tenant - usually we don't want to delete a tenant, only
   * set it to inactive
   *
   * @param {object} tenant - must match the tenant in db
   * @param {function} callback - function of the form function (error)
   */

  deleteTenant: function (tenant, callback) {
    var self = this;
    database.getDatabase(function(err, db){
      // confirm the tenant exists and is there is only one of them
      self.retrieveTenant(tenant, function (error, result) {
        if (error) {
          return callback(error);
        }

        if (result) {
          return db.destroy('tenant', tenant, callback);
        }

        return callback(new Error('No matching tenant record found'));
      });
    }, configuration.getConfig('dbName'));
  },

  loadDatabaseConfigs: function (server) {
    var self = this;

    // memoize configs
    if (!self._dbConfigs) {
      self._dbConfigs = Object.create(null);
    }

    // set master db first
    self._dbConfigs[configuration.getConfig('dbName')] = {
      'dbHost' : configuration.getConfig('dbHost'),
      'dbUser' : configuration.getConfig('dbUser'),
      'dbPass' : configuration.getConfig('dbPass'),
      'dbPort' : configuration.getConfig('dbPort'),
      'dbName' : configuration.getConfig('dbName')
    };

    database.getDatabase(function (err, db) {
      if (err) {
        logger.log('error', 'failed to load tenant databases', err);
        return;
      }

      db.retrieve('tenant', {}, function (err, results) {
        if (err) {
          logger.log('error', 'failed to load tenant databases', err);
          return;
        }

        results && results.forEach(function (item) {
          self._dbConfigs[item._id] = item.database;
        });
      });
    }, configuration.getConfig('dbName'));
  },

  /**
   * returns the database object for a named tenant
   *
   * @param {string} tenantId
   */
  getDatabaseConfig: function (tenantId) {
    if (!this._dbConfigs) {
      this._dbConfigs = Object.create(null);
    }
    return this._dbConfigs[tenantId];
  }
};
