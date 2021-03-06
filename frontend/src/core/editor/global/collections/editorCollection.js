define(function(require) {

    var Backbone = require('backbone');
    var Origin = require('coreJS/app/origin');

    var EditorCollection = Backbone.Collection.extend({
        initialize : function(models, options){
            this.url = options.url;
            this._type = options._type;
            this.on('reset', this.loadedData, this);
            this.fetch({reset:true});
        },
        
        loadedData: function() {
            Origin.trigger('editorCollection:dataLoaded', this._type);
        }
        
    });
    
    return EditorCollection;

});