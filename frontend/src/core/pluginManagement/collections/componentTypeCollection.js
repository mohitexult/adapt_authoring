define(function(require) {

  var Backbone = require('backbone');
  var ComponentTypeModel = require('coreJS/pluginManagement/models/componentTypeModel');

  var ComponentTypeCollection = Backbone.Collection.extend({

    model: ComponentTypeModel,

    url: function (options) {
      var base = 'api/componenttype';
      if (options && options.base) {
        return base;
      }

      return base + '?showall=true';
    },

    comparator: function(model) {
      return model.get('displayName');
    }

  });

  return ComponentTypeCollection;

});
