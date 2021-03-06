define(function(require) {
  var Backbone = require('backbone');
  var Origin = require('coreJS/app/origin');
  var OriginView = require('coreJS/app/views/originView');

  var LoginView = OriginView.extend({

    className: 'login',

    tagName: "div",

    events: {
      'keydown #login-input-username' : 'clearErrorStyling',
      'click .login-form-submit'      : 'submitLoginDetails',
      'keydown #login-input-password' : 'handleEnterKey'
    },

    preRender: function() {
      this.listenTo(Origin, 'login:failed', this.loginFailed, this);
    },

    postRender: function() {
      this.setViewToReady();
    },
    
    handleEnterKey: function(e) {
      var key = e.charCode ? e.charCode : e.keyCode ? e.keyCode : 0;

      if (key == 13) {
        e.preventDefault();
        this.submitLoginDetails();
      }
    },

    clearErrorStyling: function(e) {
      $('#login-input-username').removeClass('input-error');
      $('#loginErrorMessage').text('');

      this.handleEnterKey(e);
    },

    submitLoginDetails: function(e) {
      e && e.preventDefault();

      var inputUsernameEmail = $.trim(this.$("#login-input-username").val());
      var inputPassword = $.trim(this.$("#login-input-password").val());
      var shouldPersist = this.$('#remember-me').prop('checked');

      // Validation
      if (inputUsernameEmail === '' || inputPassword === '') {
        this.loginFailed(LoginView.ERR_MISSING_FIELDS);
        return false;
      } else {
        $('#login-input-username').removeClass('input-error');
      }

      var userModel = this.model;

      userModel.login(inputUsernameEmail, inputPassword, shouldPersist);
    },

    loginFailed: function(errorCode) {
      var errorMessage = '';

      switch (errorCode) {
        case LoginView.ERR_INVALID_CREDENTIALS:
        case LoginView.ERR_MISSING_FIELDS:
          errorMessage = window.polyglot.t('app.invalidusernameorpassword');        
          break;
        case LoginView.ERR_ACCOUNT_LOCKED:
          errorMessage = window.polyglot.t('app.accountlockedout');
          break;
      }

      $('#login-input-username').addClass('input-error');
      $('#loginErrorMessage').text(errorMessage);
    }

  }, {
    ERR_INVALID_CREDENTIALS: 1,
    ERR_ACCOUNT_LOCKED: 2,
    ERR_MISSING_FIELDS: 3,
    template: 'login'
  });

  return LoginView;

});
