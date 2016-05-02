var { interfaces: Ci, utils: Cu, classes: Cc } = Components;

Cu.import("resource:///modules/imServices.jsm");
Cu.import("resource:///modules/imXPCOMUtils.jsm");
Cu.import("chrome://otr/content/otr.js");

XPCOMUtils.defineLazyGetter(this, "_", () =>
  l10nHelper("chrome://otr/locale/auth.properties")
);

var [mode, uiConv, aObject] = window.arguments;

document.title = _("auth.title",
  (mode === "pref") ? aObject.screenname : uiConv.normalizedName);

function showSection(selected, hideMenu, hideAccept) {
  if (uiConv && selected === "waiting") {
    otrAuth.dialogDisplaying = false;
    let context = otr.getContext(uiConv.target);
    otr.notifyVerification(context, "otr:auth-waiting");
    document.documentElement.cancelDialog();
    return;
  }
  document.getElementById("how").hidden = !!hideMenu;
  document.documentElement.getButton("accept").hidden = !!hideAccept;
  if (selected === "finished") {
    document.documentElement.getButton("cancel").label = _("auth.done");
  }
  [ "questionAndAnswer",
    "sharedSecret",
    "manualVerification",
    "waiting",
    "ask",
    "finished"
  ].forEach(function(key) {
    document.getElementById(key).hidden = (key !== selected);
  });
  window.sizeToContent();
}

function startSMP(context, answer, question) {
  showSection("waiting", true, true);
  otrAuth.waiting = true;
  otr.sendSecret(context, answer, question);
  return false;
}

function populateFingers(context, theirs, trust) {
  let fingers = document.getElementById("fingerprints");
  let yours = otr.privateKeyFingerprint(context.account, context.protocol);
  if (!yours)
    throw new Error("Fingerprint should already be generated.");
  fingers.value =
    _("auth.yourFingerprint", context.account, yours) + "\n\n" +
    _("auth.theirFingerprint", context.username, theirs);
  let opts = document.getElementById("verifiedOption");
  let verified = trust ? "yes" : "no";
  for (let i = 0; i < opts.menupopup.childNodes.length; i ++) {
    let item = opts.menupopup.childNodes[i];
    if (verified === item.value) {
      opts.selectedItem = item;
      break;
    }
  };
}

var otrAuth = {

  dialogDisplaying: true,
  waiting: false,
  finished: false,

  onload: function() {
    if (mode !== "pref")
      otr.addObserver(otrAuth);
    let context, theirs;
    switch(mode) {
      case "start":
        context = otr.getContext(uiConv.target);
        theirs = otr.hashToHuman(context.fingerprint);
        populateFingers(context, theirs, context.trust);
        showSection("questionAndAnswer");
        break;
      case "pref":
        context = otr.getContextFromRecipient(
          aObject.account,
          aObject.protocol,
          aObject.screenname
        );
        theirs = aObject.fingerprint;
        populateFingers(context, theirs, aObject.trust);
        showSection("manualVerification", true);
        this.oninput({ value: true });
        break;
      case "ask":
        otrAuth.waiting = true;
        document.getElementById("askLabel").textContent = aObject.question
          ? _("auth.question", aObject.question)
          : _("auth.secret");
        showSection("ask", true);
        break;
    }
  },

  onunload: function() {
    if (mode !== "pref")
      otr.removeObserver(otrAuth);
  },

  accept: function() {
    let context, opts, trust;
    if (mode === "pref") {
      opts = document.getElementById("verifiedOption");
      trust = (opts.selectedItem.value === "yes");
      if (uiConv)
        context = otr.getContext(uiConv.target);
      otr.setTrust(aObject.fpointer, trust, context);
      return true;
    } else if (mode === "start") {
      context = otr.getContext(uiConv.target);
      let how = document.getElementById("howOption");
      switch(how.selectedItem.value) {
        case "questionAndAnswer":
          let question = document.getElementById("question").value;
          let answer = document.getElementById("answer").value;
          return startSMP(context, answer, question);
        case "sharedSecret":
          let secret = document.getElementById("secret").value;
          return startSMP(context, secret);
        case "manualVerification":
          opts = document.getElementById("verifiedOption");
          trust = (opts.selectedItem.value === "yes");
          otr.setTrust(context.fingerprint, trust, context);
          return true;
      }
    } else if (mode === "ask") {
      context = otr.getContext(uiConv.target);
      let response = document.getElementById("response").value;
      document.getElementById("progress").value = aObject.progress;
      document.getElementById("waitingLabel").hidden = true;
      showSection("waiting", true, true);
      otr.sendResponse(context, response);
      return false;
    }
  },

  cancel: function() {
    if (!otrAuth.dialogDisplaying) return;
    if (otrAuth.waiting && !otrAuth.finished) {
      let context = otr.getContext(uiConv.target);
      otr.abortSMP(context);
    }
  },

  oninput: function(e) {
    document.documentElement.getButton("accept").disabled = !e.value;
  },

  how: function() {
    let how = document.getElementById("howOption").selectedItem.value;
    switch(how) {
    case "questionAndAnswer":
      this.oninput(document.getElementById("answer"));
      break;
    case "sharedSecret":
      this.oninput(document.getElementById("secret"));
      break;
    case "manualVerification":
      this.oninput({ value: true });
      break;
    }
    showSection(how);
  },

  help: function() {
    let prompt = Cc["@mozilla.org/embedcomp/prompt-service;1"].getService(Ci.nsIPromptService);
    prompt.alert(window, _("auth.helpTitle"), _("auth.help"));
  },

  updateProgress: function(aObj) {
    if (!otrAuth.waiting || aObj.context.username !== uiConv.target.normalizedName)
      return;

    if (!aObj.progress) {
      otrAuth.finished = true;
      document.getElementById("finLabel").textContent = _("auth.error");
      showSection("finished", true, true);
    } else if (aObj.progress === 100) {
      otrAuth.finished = true;
      let str;
      if (aObj.success) {
        if (aObj.context.trust) {
          str = "auth.success";
          otr.notifyTrust(aObj.context);
        } else {
          str = "auth.successThem";
        }
      } else {
        str = "auth.fail";
        if (!aObj.context.trust)
          otr.notifyTrust(aObj.context);
      }
      document.getElementById("finLabel").textContent = _(str);
      showSection("finished", true, true);
    } else {
      document.getElementById("progress").value = aObj.progress;
      document.getElementById("waitingLabel").hidden = true;
    }
  },

  observe: function(aObj, aTopic, aMsg) {
    switch(aTopic) {
      case "otr:auth-update":
        otrAuth.updateProgress(aObj);
        break;
    }
  }

};