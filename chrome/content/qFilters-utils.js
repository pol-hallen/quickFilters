"use strict";
/* 
BEGIN LICENSE BLOCK

quickFilters is released under the Creative Commons (CC BY-ND 4.0)
Attribution-NoDerivatives 4.0 International (CC BY-ND 4.0) 
For details, please refer to license.txt in the root folder of this extension

END LICENSE BLOCK 
*/

// moved import code to bottom for app version detection...

var QuickFilters_TabURIregexp = {
  get _thunderbirdRegExp() {
    delete this._thunderbirdRegExp;
    return this._thunderbirdRegExp = new RegExp("^https://quickfilters.quickfolders.org/");
  }
};


quickFilters.Util = {
  ADDON_ID: "quickFilters@axelg.com",
  ADDON_SUPPORT_MAIL: "axel.grude@gmail.com",
  AssistantActive: null, // replace worker.FilterMode
  mAppver: null,
  mAppName: null,
  mHost: null,
	mPlatformVer: null,
  ConsoleService: null,
  lastTime: 0,
  _tabContainer: null,
  tempFolderTab: null,	 // likely obsolete ###
  
  async init() {

    const onBackgroundUpdates = (data) => {
      if (data.licenseInfo) {
        quickFilters.Util.licenseInfo = data.licenseInfo;
        quickFilters.Util.logDebugOptional("notifications", "onBackgroundUpdates - dispatching licenseInfo ");
        const event = new CustomEvent("quickFilters.BackgroundUpdate");
        window.dispatchEvent(event); 
      }
      // Event forwarder - take event from background script and forward to windows with appropriate listeners
      if (data.event) {
        let loc = "";
        try {
          loc = window.document.URL || window.document.location ? window.document.location.href.toString() : "";
        }
        catch(ex){;}
        if (!data.hasOwnProperty("window") || data.window.includes(loc)) {
          quickFilters.Util.logDebugOptional("notifications", 
            `onBackgroundUpdates - dispatching custom event quickFilters.BackgroundUpdate.${data.event}\n` +
            `into ${loc}`);
          let event;
          if (data.event == "setAssistantMode") {
            if (data.detail)
              quickFilters.Util.AssistantActive = data.detail.active;
            return;
          }
          
          if (data.detail) {
            event = new CustomEvent(`quickFilters.BackgroundUpdate.${data.event}`, {detail: data.detail}) 
          }
          else {
            event =  new CustomEvent(`quickFilters.BackgroundUpdate.${data.event}`) ;
          }
          window.dispatchEvent(event); 
        }       
      }      
    }   
    quickFilters.Util.notifyTools.registerListener(onBackgroundUpdates);
    
    quickFilters.Util.AssistantActive = await quickFilters.Util.notifyTools.notifyBackground({ func: "getAssistantMode" }); // replace worker.FilterMode
    quickFilters.Util.licenseInfo = await quickFilters.Util.notifyTools.notifyBackground({ func: "getLicenseInfo" });
    quickFilters.Util.platformInfo = await quickFilters.Util.notifyTools.notifyBackground({ func: "getPlatformInfo" });
    quickFilters.Util.browserInfo = await quickFilters.Util.notifyTools.notifyBackground({ func: "getBrowserInfo" });
    quickFilters.Util.addonInfo = await quickFilters.Util.notifyTools.notifyBackground({ func: "getAddonInfo" });
    quickFilters.Util.logDebugOptional("notifications",
    {
      platformInfo: quickFilters.Util.platformInfo,
      browserInfo: quickFilters.Util.browserInfo,
      addonInfo: quickFilters.Util.addonInfo,
    });
  },  

  // return main quickFilters instance (if we are in a child window / dialog or come from an event)
  get mainInstance() {
    let win = this.getMail3PaneWindow();
    return win.quickFilters;
  } ,

	get FolderFlags() {
	  if (Components.interfaces.nsMsgFolderFlags)
	    return Components.interfaces.nsMsgFolderFlags;
		else { // sigh. Postbox doesn't have this?
		  // from https://developer.mozilla.org/en-US/docs/Mozilla/Tech/XPCOM/Reference/Interface/nsMsgFolderFlagType
		  return {
			  Inbox: 0x00001000,
				Drafts: 0x00000400,
				Queue: 0x00000800,
				SentMail: 0x00000200,
				Newsgroup: 0x00000001,
				Templates: 0x00400000,
        Virtual: 0x00000020				
			}
		}
	},
		
  getMsgFolderFromUri:  function getMsgFolderFromUri(uri, checkFolderAttributes) {
		const util = quickFilters.Util,
					Cc = Components.classes,
					Ci =  Components.interfaces;
    let msgfolder = null;
    var { MailUtils } = ChromeUtils.import("resource:///modules/MailUtils.jsm");
    try {
      if (typeof MailUtils != 'undefined') {
        if (MailUtils.getExistingFolder)
          return MailUtils.getExistingFolder(uri, checkFolderAttributes);
        else	
          return MailUtils.getFolderForURI(uri, checkFolderAttributes);
      }
    }
    catch (ex) {
       //dump("failed to get the folder resource\n");
       util.logException("getMsgFolderFromUri( " + uri + ")", ex);
    }
    return msgfolder;
  } ,

  getBundleString: function getBundleString(id, defaultText, substitions = []) { // moved from local copies in various modules.
    // [mx-l10n]
    var { ExtensionParent } = ChromeUtils.import("resource://gre/modules/ExtensionParent.jsm");
    let extension = ExtensionParent.GlobalManager.getExtension('quickFilters@axelg.com');
    let localized = extension.localeData.localizeMessage(id, substitions);
  
    let s = "";
    if (localized) {
      s = localized;
    }
    else {
      s = defaultText;
      this.logToConsole ("Could not retrieve bundle string: " + id + "");
    }
    return s;
  } ,
  
  localize: function(window, buttons = null) {
    Services.scriptloader.loadSubScript(
      quickFilters.Util.extension.rootURI.resolve("chrome/content/i18n.js"),
      window,
      "UTF-8"
    );
    window.i18n.updateDocument({extension: quickFilters.Util.extension});
    if (buttons) {
      for (let [name, label] of Object.entries(buttons)) {
        window.document.documentElement.getButton(name).label =  quickFilters.Util.extension.localeData.localizeMessage(label); // apply
      }
    }
  } ,
  

  getMail3PaneWindow: function getMail3PaneWindow() {
    let windowManager = Components.classes['@mozilla.org/appshell/window-mediator;1']
        .getService(Components.interfaces.nsIWindowMediator),
        win3pane = windowManager.getMostRecentWindow("mail:3pane");
    return win3pane;
  } ,
  
  getLastFilterListWindow: function getLastFilterListWindow() {
    let mediator = Components.classes["@mozilla.org/appshell/window-mediator;1"].getService(Components.interfaces.nsIWindowMediator);
    return mediator.getMostRecentWindow('mailnews:filterlist');
  } ,

  get AppverFull() {
    let appInfo = Components.classes["@mozilla.org/xre/app-info;1"]
            .getService(Components.interfaces.nsIXULAppInfo);
    return appInfo.version;
  },

  get Appver() {
    if (null === this.mAppver) {
    let appVer=this.AppverFull.substr(0,3); // only use 1st three letters - that's all we need for compatibility checking!
      this.mAppver = parseFloat(appVer); // quick n dirty!
    }
    return this.mAppver;
  },

  get Application() {
    if (null===this.mAppName) {
    let appInfo = Components.classes["@mozilla.org/xre/app-info;1"]
            .getService(Components.interfaces.nsIXULAppInfo);
      const FIREFOX_ID = "{ec8030f7-c20a-464f-9b0e-13a3a9e97384}";
      const THUNDERBIRD_ID = "{3550f703-e582-4d05-9a08-453d09bdfdc6}";
      const SEAMONKEY_ID = "{92650c4d-4b8e-4d2a-b7eb-24ecf4f6b63a}";
      const POSTBOX_ID = "postbox@postbox-inc.com";
      switch(appInfo.ID) {
        case FIREFOX_ID:
          return this.mAppName='Firefox';
        case THUNDERBIRD_ID:
          return this.mAppName='Thunderbird';
        case SEAMONKEY_ID:
          return this.mAppName='SeaMonkey';
        case POSTBOX_ID:
          return this.mAppName='Postbox';
        default:
          this.mAppName=appInfo.name;
          this.logDebug ( 'Unknown Application: ' + appInfo.name);
          return appInfo.name;
      }
    }
    return this.mAppName;
  },
  
  get HostSystem() {
    if (null===this.mHost) {
      let osString = Components.classes["@mozilla.org/xre/app-info;1"]
            .getService(Components.interfaces.nsIXULRuntime).OS;
      this.mHost = osString.toLowerCase();
    }
    return this.mHost; // linux - winnt - darwin
  },

  get Version() {
    // this used to call VersionProxy() which opened quickfolders.init
    quickFilters.Util.logDebug("Version() getter. addonInfo:", quickFilters.Util.addonInfo);
    return quickFilters.Util.addonInfo.version;
  } ,

  get VersionSanitized() {
    return this.getVersionSimple(this.Version);
  } ,
  
  getVersionSimple: function getVersionSimple(ver) {
    let pureVersion = ver,  // default to returning unchanged
        // get first match starting with numbers mixed with .   
        reg = new RegExp("[0-9.]*"),
        results = ver.match(reg); 
    if (results) 
      pureVersion = results[0];
    return pureVersion;
  } ,

	get PlatformVersion() {
		if (null==this.mPlatformVer)
			try {
				let appInfo = Components.classes["@mozilla.org/xre/app-info;1"].getService(Components.interfaces.nsIXULAppInfo);
				this.mPlatformVer = parseFloat(appInfo.platformVersion);
			}
			catch(ex) {
				this.mPlatformVer = 78.0; // just a guess
			}
		return this.mPlatformVer;
	} ,
	
	
  isVirtual: function isVirtual(folder) {
    if (!folder)
      return true;
		if (quickFilters.Util.FolderFlags.Virtual & folder.flags)
		  return true;
    return (folder.username && folder.username == 'nobody') || (folder.hostname == 'smart mailboxes');
  } ,
	
	isLocalInbox: function(folder) {
		if (folder)
		 return folder.flags && 
			    (folder.flags & this.FolderFlags.Inbox) &&
			    (folder.flags & this.FolderFlags.Mail) && 
					(folder.server.username == "nobody" && folder.server.type == "none") ? true : false;
		return false;
	} ,
	
	applyFiltersToFolder: function qfUtil_applyFiltersToFolder(folder, singleFilter) {
		// a local copy of  MsgApplyFilters()
		const Ci = Components.interfaces,
		      Cc = Components.classes,
					util = quickFilters.Util,
		      filterService = Cc["@mozilla.org/messenger/services/filters;1"]
													.getService(Ci.nsIMsgFilterService);

		try {
			if (folder.isServer) { // if this is root, replace it with appropriate inbox
			  let f = quickFilters.Shim.findInboxFromRoot(folder, util.FolderFlags);
				if (!f) 
					f = folder.getChildNamed('Inbox');
				if (f) folder = f;
			}
      
			let isListArray = util.versionGreaterOrEqual(util.AppverFull, "85"),
          selectedFolders = isListArray ? [] : Cc["@mozilla.org/array;1"].createInstance(Ci.nsIMutableArray);
      if (isListArray)
        selectedFolders.push(folder);
			else
        selectedFolders.appendElement(folder);
			
			// create a new filter list and copy over the enabled filters to it.
			
			let curFilterList = folder.getFilterList(null), /* msgWindow */
					tempFilterList = filterService.getTempFilterList(folder),
					numFilters = curFilterList.filterCount;
			// make sure the temp filter list uses the same log stream
			tempFilterList.logStream = curFilterList.logStream;
			tempFilterList.loggingEnabled = curFilterList.loggingEnabled;
			let newFilterIndex = 0;
			if (singleFilter) {
				tempFilterList.insertFilterAt(0, singleFilter);
			}
			else for (let i = 0; i < numFilters; i++) {
				let curFilter = curFilterList.getFilterAt(i);
				// only add enabled, UI visibile filters that are in the manual context
				if (curFilter.enabled && !curFilter.temporary &&
						(curFilter.filterType & Ci.nsMsgFilterType.Manual))
				{
					tempFilterList.insertFilterAt(newFilterIndex, curFilter);
					newFilterIndex++;
				}
			}
			if (singleFilter) {
				let txtStatus = util.getBundleString('quickfilters.runSingleFilterInFolder.status', "Running Filter '{0}' in folder {1}.");
				util.showStatusMessage(txtStatus.replace("{0}", singleFilter.filterName).replace("{1}", folder.prettyName), true);
			}
			else {
				let txtStatus = util.getBundleString('quickfilters.runSingleFilterInFolder.status', "Running '{0}' Filters in folder {1}.");
				util.showStatusMessage(txtStatus.replace("{0}", numFilters).replace("{1}", folder.prettyName), true);
			}
			filterService.applyFiltersToFolders(tempFilterList, selectedFolders, null);
		}
		catch(ex) {
			util.logException("applyFiltersToFolder()", ex);
		}

	
	} ,

	get tabContainer() {
		if (!this._tabContainer) {
		  let doc = this.getMail3PaneWindow().document;
			this._tabContainer = doc.getElementById('tabmail').tabContainer;
		}
		return this._tabContainer;
	} ,
	
	getTabInfoByIndex: function getTabInfoByIndex(tabmail, idx) {
		if (tabmail.tabInfo)
			return tabmail.tabInfo[idx];
		if (tabmail.tabOwners)
		  return tabmail.tabOwners[idx];  // Postbox
		return null;
	} ,	
	
	get mailFolderTypeName() {
    return "folder";
	} ,	
	
	get tabmail() {
		let doc = this.getMail3PaneWindow().document,
		    tabmail = doc.getElementById("tabmail");
		return tabmail;
	} ,
	
	// likely obsolete ###
	// use this to temporarily open a tab for a folder if the msgDatabase remains invalid.
	// there should be another way to do this, but for the moment this is the workaround.
	openTempFolderInNewTab: function openTempFolderInNewTab(folder, background) {
		let win = this.getMail3PaneWindow(),
		    tabmail = this.tabmail;
		if (tabmail) {
		  let tabName = folder.name;
		  this.tempFolderTab = tabmail.openTab(this.mailFolderTypeName, 
			  {folder: folder, messagePaneVisible: true, background: background, disregardOpener: true, 
				title: tabName} ) ; 
		}
	} ,
	
	// likely obsolete ###
	closeTempFolderTab: function closeTempFolderTab() {
	  if(this.tempFolderTab) {
		  if (this.tabmail.closeTab)
				this.tabmail.closeTab(this.tempFolderTab);
			this.tempFolderTab = null;
		}
	} ,
	
  slideAlert: function slideAlert(text, title, icon) {
    const Ci = Components.interfaces,
					Cc = Components.classes,
					util = quickFilters.Util;
    try {
      if (!icon)
        icon = "chrome://quickfilters/content/skin/QuickFilters_32.svg";
      else
        icon = "chrome://quickfilters/content/skin/" + icon;
      if (!title)
        title = "quickFilters";
      util.logToConsole('popupAlert(' + text + ', ' + title + ')');
			// let's put this into a timeout
			window.setTimeout(function() {
				let service = Cc['@mozilla.org/alerts-service;1'].getService(Ci.nsIAlertsService);
        service.showAlertNotification(icon, title, text, false, '', null);
			});
    }
    catch(e) {
      // prevents runtime error on platforms that don't implement nsIAlertsService
      alert(text);
    }
  } ,
  
  popupAlert: function popupAlert(text, title, icon, timeOut) {
    try {
			let isTimeout = !(timeOut == 0);
			if (!timeOut) timeOut = 4000;
      if (!icon)
        icon = "chrome://quickfilters/content/skin/QuickFilters_32.png";
      else
        icon = "chrome://quickfilters/content/skin/" + icon;
      if (!title)
        title = "quickFilters";
      let panel = document.getElementById('quickFilterNotification');
      if (panel) {
        panel.openPopup(null, "after_start", 0, 0, false, false);
        let notificationBox = document.getElementById('quickFilterNotificationBox'),
            priority = notificationBox.PRIORITY_WARNING_MEDIUM,
            // appendNotification( label , value , image , priority , buttons, eventCallback )
            notification;
        if (notificationBox.shown) { // new notification format (Post Tb 99)
          notification = notificationBox.appendNotification( 
            notificationKey, // "String identifier that can uniquely identify the type of the notification."
            {
              priority: priority,
              label: text,
              eventCallback: null
            },
            null // no buttons
          );
        }
        else {
          notification = notificationBox.appendNotification( text , null , icon , priority, null, null ); 
        }
        notificationBox.addEventListener('alertclose', function() { alert('test'); });
        
        // setting img was removed in Tb91  
        if (notification.messageImage.tagName == "span") {
          let container = notification.shadowRoot.querySelector(".container");
          if (container) {
            let im = document.createElement("img");
            im.setAttribute("src", icon);
            container.insertBefore(im, notification.shadowRoot.querySelector(".icon"));
          }
        }             
        
        if (isTimeout)
					window.setTimeout(function() {try{notificationBox.removeNotification(notification)}catch(e){};panel.hidePopup();}, timeOut);
      }
      else {
        let prompts = Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
                                      .getService(Components.interfaces.nsIPromptService);
        prompts.alert(window, title, text); 
      }
    }
    catch(e) {
      // prevents runtime error on platforms that don't implement nsIAlertsService
      this.logException (`quickFilters.util.popupAlert(${text}) `, e);
      alert(text);
    }
  } ,
  
  alert: function alert(msg, caption) {
    caption = caption || "quickFilters";
    Services.prompt.alert(null, caption, msg);
  },
  	
	
  /* quickFilters Pro / licensing features */
	// default to isRegister from now = show button for buying a license.
	// featureName: namne of the feature used (will be transmitted to shop when purchasing)
	// isRegister: show registration button
	popupProFeature: function popupProFeature(featureName, isRegister, additionalText) {
		let util = quickFilters.Util,
				prefs = quickFilters.Preferences,
        countDown = null;
        
    if (util.hasPremiumLicense())
      return true;
		
		let notifyBox,
		    mainWin = util.getMail3PaneWindow();
		if (typeof mainWin.specialTabs == 'object' && mainWin.specialTabs.msgNotificationBar) { // Tb 78
			notifyBox = mainWin.specialTabs.msgNotificationBar;
		}
		else if( typeof gNotification == 'object' && gNotification.notificationbox) { // Tb 68
			notifyBox = gNotification.notificationbox;
		}

		let title = util.getBundleString("quickfilters.notification.proFeature.title", "Premium Feature"),
		    theText = util.getBundleString("quickfilters.notification.premium.text",
				"{1} is a Premium feature, please get a quickFilters Pro License for using it. "),
        featureTitle = 
          (featureName.includes(' ')) ?
          featureName : util.getBundleString('quickfilters.premium.title.' + featureName, featureName);
		theText = theText.replace ("{1}", "'" + featureTitle + "'");
		if (additionalText)
			theText = theText + '  ' + additionalText;
		
		let regBtn,
        hotKey = util.getBundleString("quickfilters.notification.premium.btn.hotKey", "L"),
				nbox_buttons = [],
        dontShow = util.getBundleString("quickfilters.notification.dontShowAgain", "Do not show this message again.") + ' [' + featureTitle + ']';
				
		if (notifyBox) {
			let notificationKey = "quickfilters-proFeature";
			try {
				if (featureName.indexOf('Advanced search') == 0) {
					featureName="advancedSearchType";
        }
        try {
          countDown = prefs.getIntPref("restrictions." + featureName + ".countDown") ;
        }
        catch (ex) {
          countDown = 5;
        }
				countDown--;
        if (countDown>0) {
          let countText = util.getBundleString("quickfilters.notification.premium.freeUses", "You can use this feature for free {1} more times.");
          countText = countText.replace("{1}", countDown);
          theText = theText + " " + countText;
        }
				prefs.setIntPref("restrictions." + featureName + ".countDown", countDown);
				util.logDebug('Showing notifyBox for [' + notificationKey + ']...\n'
																	 + 'Countdown is ' + countDown);
			}
			catch(ex) {};
      
			if (!hotKey) hotKey='L'; // we also use this for hacking the style of the "Buy" button!
      if (util.licenseInfo.isExpired) {
        regBtn = util.getBundleString("quickfilters.notification.premium.btn.renewLicense", "Renew License!");
      }
      else {
			  regBtn = util.getBundleString("quickfilters.notification.premium.btn.getLicense", "Buy License!");
      }
      
      // registration button
      if (isRegister) {
        
        nbox_buttons.push(
          {
            label: regBtn,
            accessKey: hotKey,   
            callback: function() { 
              quickFilters.Util.showLicenseDialog(featureName); 
            },
            popup: null
          }
        );
      }

			
      let item = notifyBox.getNotificationWithValue(notificationKey);
      if (item)
        notifyBox.removeNotification(item, false);
		  const imgSrc = "chrome://quickfilters/content/skin/proFeature.png";
    
			let newNotification;

      if (notifyBox.shown) { // new notification format (Post Tb 99)
        newNotification = notifyBox.appendNotification( 
          notificationKey, // "String identifier that can uniquely identify the type of the notification."
          {
            priority: notifyBox.PRIORITY_WARNING_HIGH,
            label: theText,
            eventCallback: null
          },
          nbox_buttons // no buttons
        );
      }
      else {
        newNotification = notifyBox.appendNotification( theText, 
          notificationKey , 
          imgSrc, 
          notifyBox.PRIORITY_WARNING_HIGH, 
          nbox_buttons ); // , eventCallback
      }
       
      // setting img was removed in Tb91
      if (newNotification.messageImage.tagName == "span") {
        // style needs to go into shadowroot
        let linkEl = document.createElement("link");
        linkEl.setAttribute("rel", "stylesheet");
        linkEl.setAttribute("href", "chrome://quickfilters/content/skin/qFilters-notifications.css");
        newNotification.shadowRoot.insertBefore(linkEl, newNotification.shadowRoot.firstChild.nextSibling);         
        
        let container = newNotification.shadowRoot.querySelector(".container");
        if (container) {
          let im = document.createElement("img");
          im.setAttribute("src", imgSrc);
          container.insertBefore(im, newNotification.shadowRoot.querySelector(".icon"));
        }
      }
      return (countDown>=0);
		}
		else {
			// fallback for systems that do not support notification (currently: SeaMonkey)
			let prompts = Components.classes["@mozilla.org/embedcomp/prompt-service;1"]  
															.getService(Components.interfaces.nsIPromptService),  
			    result = prompts.alert(null, title, theText); 
      return true;
		}
	} ,  

  showStatusMessage: function showStatusMessage(s, isTimeout) {
    try {
			let win = this.getMail3PaneWindow(),
          sb = win.document.getElementById('status-bar'),
          el, sbt;
      if (sb) {
        for(let i = 0; i < sb.childNodes.length; i++)
        {
          el = sb.childNodes[i];
          if (el.nodeType === 1 && el.id === 'statusTextBox') {
            sbt = el;
              break;
          }
        }
				if (sbt)
					for(let i = 0; i < sbt.childNodes.length; i++)
					{
						el = sbt.childNodes[i];
						if (el.nodeType === 1 && el.id === 'statusText') {
							el.label = s;
							if (isTimeout) {
								// erase my status message after 5 secs
								win.setTimeout(function() { 
								    if (el.label == s) // remove my message if it is still there
											el.label = "";
									}, 
									5000);
							}
							break;
						}
					}
      }
      else
        MsgStatusFeedback.showStatusString(s);
    }
    catch(ex) {
      this.logToConsole("showStatusMessage - " +  ex);
      MsgStatusFeedback.showStatusString(s);
    }
  } ,

  getCurrentFolder: function getCurrentFolder() {
		const util = quickFilters.Util;
    let aFolder;
    if (typeof(GetLoadedMsgFolder) != 'undefined') {
      aFolder = GetLoadedMsgFolder();
    }
    else
    {
      let currentURI;
      if (typeof GetSelectedFolderURI === 'function') {
				// old Postbox
        currentURI = GetSelectedFolderURI();
      }
      else {
        if (gFolderDisplay.displayedFolder)
          currentURI = gFolderDisplay.displayedFolder.URI;
        // aFolder = FolderParam.QueryInterface(Components.interfaces.nsIMsgFolder);
      }
      // in search result folders, there is no current URI!
      if (!currentURI)
        return null;
      aFolder = util.getMsgFolderFromUri(currentURI, true).QueryInterface(Components.interfaces.nsIMsgFolder); // inPB case this is just the URI, not the folder itself??
    }
    return aFolder;
  } ,
	
  pbGetSelectedMessageUris: function pbGetSelectedMessageUris() {
    let messageArray = {},
        length = {},
        view = GetDBView();
    view.getURIsForSelection(messageArray, length);
    if (length.value) {
      return messageArray.value;
    }
    else
      return null;
  },
  

  logTime: function logTime() {
    let timePassed = '',
        end = new Date(),
        endTime = end.getTime();
    try { // AG added time logging for test
      if (this.lastTime === 0) {
        this.lastTime = endTime;
        return "[logTime init]"
      }
      let elapsed = new String(endTime - this.lastTime); // time in milliseconds
      timePassed = '[' + elapsed + ' ms]   ';
      this.lastTime = endTime; // remember last time
    }
    catch(e) {;}
    return end.getHours() + ':' + end.getMinutes() + ':' + end.getSeconds() + '.' + end.getMilliseconds() + '  ' + timePassed;
  },

  logToConsole: function logToConsole(msg, optionTag) {
    let qF = quickFilters ? quickFilters : this.mainInstance,
        util = qF.Util;
    if (util.ConsoleService === null)
      util.ConsoleService = Components.classes["@mozilla.org/consoleservice;1"]
                  .getService(Components.interfaces.nsIConsoleService);
    util.ConsoleService.logStringMessage("quickFilters " 
			+ (optionTag ? '{' + optionTag.toUpperCase() + '} ' : '')
			+ this.logTime() + "\n"+ msg);
  },

  // flags
  // errorFlag    0x0   Error messages. A pseudo-flag for the default, error case.
  // warningFlag    0x1   Warning messages.
  // exceptionFlag  0x2   An exception was thrown for this case - exception-aware hosts can ignore this.
  // strictFlag     0x4
  logError: function logError(aMessage, aSourceName, aSourceLine, aLineNumber, aColumnNumber, aFlags) {
    const Ci = Components.interfaces,
					Cc = Components.classes;
    let consoleService = Cc["@mozilla.org/consoleservice;1"]
                                   .getService(Ci.nsIConsoleService),
        aCategory = '',
        scriptError = Cc["@mozilla.org/scripterror;1"].createInstance(Ci.nsIScriptError);
    scriptError.init(aMessage, aSourceName, aSourceLine, aLineNumber, aColumnNumber, aFlags, aCategory);
    consoleService.logMessage(scriptError);
  } ,

  logException: function logException(aMessage, ex) {
    let stack = '';
    if (typeof ex.stack!='undefined')
      stack= ex.stack.replace("@","\n  ");

    let srcName = ex.fileName ? ex.fileName : "";
    this.logError(aMessage + "\n" + ex.message, srcName, stack, ex.lineNumber, 0, 0x1); // use warning flag, as this is an exception we caught ourselves
  } ,
  
  logDebug: function logDebug(msg) {
    let qF = quickFilters ? quickFilters : this.mainInstance;
    if (qF.Preferences.isDebug)
      this.logToConsole(msg);
  },

  /** 
	* only logs if debug mode is set and specific debug option are active
	* 
	* @optionString {string}: comma delimited options
  * @msg {string}: text to log 
	*/   
  logDebugOptional: function logDebugOptional(optionString, msg) {
		try {
			let qF = quickFilters ? quickFilters : this.mainInstance,
					options = optionString.split(',');
			for (let i=0; i<options.length; i++) {
				let option = options[i];
				if (qF.Preferences.isDebugOption(option)) {
					this.logToConsole(msg, option);
					break; // only log once, in case multiple log switches are on
				}
			}        
		}
		catch(ex) {;}
  },
	
	
	
  // safe wrapper to get member from account.identities array
  getIdentityByIndex: function getIdentityByIndex(ids, index) {
    const Ci = Components.interfaces;
    if (!ids) return null;
    try {
      // replace queryElementAt with array[index].QueryInterface!
      if (ids[index])
        return ids[index].QueryInterface(Ci.nsIMsgIdentity);
      return null;
    }
    catch(ex) {
      quickFilters.Util.logDebug('Exception in getIdentityByIndex(ids,' + index + ') \n' + ex.toString());
    }
    return null;
  } ,
	
  getTabInfoLength: function getTabInfoLength(tabmail) {
		if (tabmail.tabInfo)
		  return tabmail.tabInfo.length;
	  if (tabmail.tabOwners)
		  return tabmail.tabOwners.length;
		return null;
	} ,
	
	getTabMode: function getTabMode(tab) {
	  if (tab.mode) {   // Tb / Sm
			return tab.mode.name;
		}
		if (tab.type)  // Pb
		  return tab.type;
		return "";
	},
	
	getBaseURI: function baseURI(URL) {
		let hashPos = URL.indexOf('#'),
				queryPos = URL.indexOf('?'),
				baseURL = URL;
				
		if (hashPos>0)
			baseURL = URL.substr(0, hashPos);
		else if (queryPos>0)
			baseURL = URL.substr(0, queryPos);
		if (baseURL.endsWith('/'))
			return baseURL.substr(0, baseURL.length-1); // match "x.com" with "x.com/"
		return baseURL;		
	} ,
	
	findMailTab: function findMailTab(tabmail, URL) {
		const util = quickFilters.Util;
    var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
		// mail: tabmail.tabInfo[n].browser		
		let baseURL = util.getBaseURI(URL),
				numTabs = util.getTabInfoLength(tabmail);
		
		for (let i = 0; i < numTabs; i++) {
			let info = util.getTabInfoByIndex(tabmail, i);
			if (info.browser && info.browser.currentURI) {
				let tabUri = util.getBaseURI(info.browser.currentURI.spec);
				if (tabUri == baseURL) {
					tabmail.switchToTab(i);
          try {
            let params = {
              triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
            }
            info.browser.loadURI(URL, params);
          }
          catch(ex) {
            util.logException(ex);
          }
					return true;
				}
			}
		}
		return false;
	} ,	
		

  // dedicated function for email clients which don't support tabs
  // and for secured pages (donation page).
  openLinkInBrowserForced: function openLinkInBrowserForced(linkURI) {
    const Ci = Components.interfaces,
					Cc = Components.classes;
    try {
      this.logDebug("openLinkInBrowserForced (" + linkURI + ")");
      let service = Cc["@mozilla.org/uriloader/external-protocol-service;1"]
                              .getService(Ci.nsIExternalProtocolService),
          ioservice = Cc["@mozilla.org/network/io-service;1"].
            getService(Ci.nsIIOService),
          uri = ioservice.newURI(linkURI, null, null);
      service.loadURI(uri);
    }
    catch(e) { this.logDebug("openLinkInBrowserForced (" + linkURI + ") " + e.toString()); }
  },

  // moved from options.js
  // use this to follow a href that did not trigger the browser to open (from a XUL file)
  openLinkInBrowser: function openLinkInBrowser(evt,linkURI) {
    let Cc = Components.classes,
        Ci = Components.interfaces,
				util = quickFilters.Util;
		linkURI = util.makeUriPremium(linkURI);
    let service = Cc["@mozilla.org/uriloader/external-protocol-service;1"]
                    .getService(Ci.nsIExternalProtocolService),
        ioservice = Cc["@mozilla.org/network/io-service;1"]
                      .getService(Ci.nsIIOService);
    service.loadURI(ioservice.newURI(linkURI, null, null));
    if(null !== evt)
      evt.stopPropagation();
  },

  // moved from options.js (then called
  openURL: function openURL(evt,URL) { // workaround for a bug in TB3 that causes href's not be followed anymore.
	  const util = quickFilters.Util;
    let ioservice,iuri,eps;

    if (this.openURLInTab(URL) && null!=evt) {
      if (evt.preventDefault)  evt.preventDefault();
      if (evt.stopPropagation)  evt.stopPropagation();
    }
  },

  openURLInTab: function openURLInTab(URL) {
    let util = quickFilters.Util;
		URL = util.makeUriPremium(URL);
    try {
			let sTabMode="",
			    tabmail = this.tabmail;
			if (!tabmail) {
				// Try opening new tabs in an existing 3pane window
				let mail3PaneWindow = this.getMail3PaneWindow();
				if (mail3PaneWindow) {
					tabmail = mail3PaneWindow.document.getElementById("tabmail");
					mail3PaneWindow.focus();
				}
			}
			// note: findMailTab will activate the tab if it is already open
			if (tabmail) {
				if (!util.findMailTab(tabmail, URL)) {
          sTabMode = "contentTab";  // "3pane" for Apver <= 3
					tabmail.openTab(sTabMode,
					{contentPage: URL, url: URL, clickHandler: "specialTabs.siteClickHandler(event, QuickFilters_TabURIregexp._thunderbirdRegExp);"});
				}
			}
			else {
				window.openDialog("chrome://messenger/content/", "_blank",
									"chrome,dialog=no,all", null,
					{ tabType: "contentTab", 
						tabParams: {contentPage: URL, url: URL, clickHandler: "specialTabs.siteClickHandler(event, QuickFilters_TabURIregexp._thunderbirdRegExp);", id:"QuickFilters_Weblink"} 
					} 
				);
			}
		}
    catch(e) { return false; }
    return true;
  } ,
	
	versionGreaterOrEqual: function(a, b) {
		/*
			Compares Application Versions
			returns
			- is smaller than 0, then A < B
			-  equals 0 then Version, then A==B
			- is bigger than 0, then A > B
		*/
		let versionComparator = Components.classes["@mozilla.org/xpcom/version-comparator;1"]
														.getService(Components.interfaces.nsIVersionComparator);
		return (versionComparator.compare(a, b) >= 0);
	} ,

	versionSmaller: function(a, b) {
		/*
			Compares Application Versions
			returns
			- is smaller than 0, then A < B
			-  equals 0 then Version, then A==B
			- is bigger than 0, then A > B
		*/
		let versionComparator = Components.classes["@mozilla.org/xpcom/version-comparator;1"]
														.getService(Components.interfaces.nsIVersionComparator);
		 return (versionComparator.compare(a, b) < 0);
	} ,	
	
	debugMsgAndFolders: function debugMsgAndFolders(label1, val1, targetFolder, msg, filterAction) {
	  if (!quickFilters.Preferences.isDebugOption("createFilter"))
		  return;
	  try {
			if (msg)
				quickFilters.Util.logDebugOptional ("createFilter",
						"Message(\n"
							+ label1 + "=" + val1 + "\n"
							+ " target folder="+ (targetFolder ? targetFolder.prettyName || '' : 'missing') + "\n"
							+ " message Id=" + msg.messageId + "\n"
							+ " author=" + (msg.mime2DecodedAuthor || '') + "\n"
							+ " subject=" + (msg.mime2DecodedSubject || '') + "\n"
							+ " recipients=" + (msg.mime2DecodedRecipients || '') + "\n"
							+ " filterAction=" + (filterAction || '') + "\n"
							+ " cc=" + (msg.ccList || '') + "\n"
							+ " bcc=" + (msg.bccList || '') + "\n"
							+ " author=" +( msg.author || '')
							+ ")");	
			else {
				quickFilters.Util.logDebugOptional ("createFilter",
						"Message(\n"
							+ label1 + "=" + val1 + "\n"
							+ " target folder="+ (targetFolder ? targetFolder.prettyName || '' : 'missing') + "\n"
							+ "msg is null.");
			}
		}
		catch(ex) {
		  quickFilters.Util.logDebugOptional ("createFilter", "Exception: " + ex);
		}
	} ,
	
	// ### [Bug 25688] Creating Filter on IMAP fails after 7 attempts ###
	// so let's store the header itself as well, just in case
	makeMessageListEntry: function makeMessageListEntry(msgHeader, Uri) {
	  return {"messageId":msgHeader.messageId, "msgHeader":msgHeader, "messageURI":Uri};
	} ,

  createMessageIdArray: function createMessageIdArray(targetFolder, messageUris) {
    let Ci = Components.interfaces;
    try {
      try {quickFilters.Util.logDebugOptional('dnd', 'quickFilters.Util.createMessageIdArray: target = ' + targetFolder.prettyName );}
      catch(e) { alert('quickFilters.Util.createMessageIdArray:' + e); }

      if (targetFolder.flags & this.FolderFlags.Virtual) {  // Ci.nsMsgFolderFlags.Virtual
        return null;
      }

      let messageIdList = [];
      for (let i = 0; i < messageUris.length; i++) {
        let Uri = messageUris[i],
            msgHeader = messenger.messageServiceFromURI(Uri).messageURIToMsgHdr(Uri); // retrieve nsIMsgDBHdr
        messageIdList.push(this.makeMessageListEntry(msgHeader, Uri));  // ### [Bug 25688] Creating Filter on IMAP fails after 7 attempts ###
				quickFilters.Util.debugMsgAndFolders('Uri', Uri.toString(), targetFolder, msgHeader, "--");
      }

      return messageIdList;
    }
    catch(e) {
      this.logToConsole('Exception in quickFilters.Util.createMessageIdArray \n' + e);
      return null;
    };
    return null;
  } ,

  /**
   * Installs the toolbar button with the given ID into the given
   * toolbar, if it is not already present in the document.
   *
   * @param {string} toolbarId The ID of the toolbar to install to.
   * @param {string} id The ID of the button to install.
   * @param {string} afterId The ID of the element to insert after. @optional
   */
  installButton: function installButton(toolbarId, id, afterId) {
    if (!document.getElementById(id)) {
      try {
        this.logDebug("installButton(" + toolbarId + "," + id + "," + afterId + ")");

        let toolbar = document.getElementById(toolbarId),
            before = null;
        
        if (afterId) {
          let elem = document.getElementById(afterId);
          if (elem && elem.parentNode == toolbar)
              before = elem.nextElementSibling;
        }
        else { // If no afterId is given, then insert the item to the toolbar before the search box.
          // [issue 100] - Improve location of toolbar buttons when installing quickFilters
          before = document.getElementById("gloda-search"); // by default this is usually to the left of the button-appmenu
          if (!before) {
            before = document.getElementById("button-appmenu");
          }
          if (before) {
            if (before.previousSibling && before.previousSibling.tagName == "toolbarspring") {
              before = before.previousSibling;
            }
          }
        }

        this.logDebug("toolbar.insertItem(" + id  + "," + before + ")");
        toolbar.insertItem(id, before);
        toolbar.setAttribute("currentset", toolbar.currentSet);
        this.logDebug("document.persist(" + toolbar.id + ")");
        if (document.persist)
          document.persist(toolbar.id, "currentset");
        else { // code from customizeToolbar.js
          var {Services} = ChromeUtils.import("resource://gre/modules/Services.jsm"),
              currentSet = toolbar.currentSet;
          toolbar.setAttribute("currentset", currentSet);
          Services.xulStore.persist(toolbar, "currentset");
        }
      }
      catch(ex) {
        this.logException("quickFilters.Util.installButton", ex);
      }
     }
  }  ,

  showVersionHistory: function showVersionHistory() {
		const util = quickFilters.Util;
    let version = util.VersionSanitized;
    util.openURL(null, util.makeUriPremium("https://quickfilters.quickfolders.org/version.html") + "#" + version);
  } ,

  showLicensePage: function showLicensePage() {
    quickFilters.Util.openURLInTab('https://quickfilters.quickfolders.org/donate.html');
  }  ,
	
	showYouTubePage: function showYouTubePage() {
		quickFilters.Util.openLinkInBrowserForced('https://www.youtube.com/playlist?list=PLApv7QYQO9nSUTaBbX8ZTz2XcIt61l73V');
	} ,

  showHomePage: function showHomePage(queryString) {
	  if (!queryString) queryString='index.html';
    quickFilters.Util.openURLInTab('https://quickfilters.quickfolders.org/' + queryString);
  } ,
	
  showBug: function showBug(bugNumber) {
    quickFilters.Util.openURLInTab('https://quickfolders.org/bugzilla/bugs/show_bug.cgi@id=' + bugNumber);
  } ,
  
  showIssue: function showIssue(issueNumber) {
    quickFilters.Util.openURLInTab('https://github.com/RealRaven2000/quickFilters/issues/' + issueNumber);
  } ,
  
	showYouTube: function showYouTube() {
		quickFilters.Util.openLinkInBrowserForced('https://www.youtube.com/c/thunderbirddaily');
	} ,
	
	showPremiumFeatures: function showPremiumFeatures() {
    quickFilters.Util.openURLInTab('https://quickfilters.quickfolders.org/premium.html');
	} ,
	
  // Postbox special functions to avoid line being truncated
  // removes description.value and adds it into inner text
  fixLineWrap: function fixLineWrap(notifyBox, notificationKey) {
    try {
      if (!notifyBox || !notificationKey)
        return;
      let note = notifyBox.getNotificationWithValue(notificationKey);
      // if we  could get at the description element within the notificaiton 
      // we could empty the value and stick thje text into textContent instead!
      let hbox = note.boxObject.firstChild.firstChild;
      if (hbox) {
        this.logDebug('hbox = ' + hbox.tagName + ' hbox.childNodes: ' + hbox.childNodes.length);
        let desc = hbox.childNodes[1];
        desc.textContent = desc.value.toString();
        desc.removeAttribute('value');
      }
    }
    catch(ex) {
      this.logException('Postbox notification: ', ex);
    }
  } ,
  
  versionLower: function versionLower(a, b) {
    let versionComparator = Components.classes["@mozilla.org/xpcom/version-comparator;1"]
                            .getService(Components.interfaces.nsIVersionComparator);
    return (versionComparator.compare(a, b) < 0);
  } ,
  
  versionHigher: function versionHigher(a, b) {
    let versionComparator = Components.classes["@mozilla.org/xpcom/version-comparator;1"]
                            .getService(Components.interfaces.nsIVersionComparator);
    return (versionComparator.compare(a, b) > 0);
  } ,
	
	isStringAttrib: function isStringAttrib(attr) {
	  const AC = Components.interfaces.nsMsgSearchAttrib;
		let isString =
	    !( attr == AC.Priority || attr == AC.Date || attr == AC.MsgStatus || attr == AC.MessageKey || attr == AC.Size || attr == AC.AgeInDays
		  || attr == AC.FolderInfo || attr == AC.Location || attr == AC.Label || attr == AC.JunkStatus || attr == AC.Uint32HdrProperty
			|| attr == AC.JunkPercent || attr == AC.HasAttachmentStatus);
		// what about To, Sender, CC, Subject
		return isString;   
	},

	// function to extract any header (including custom header) from the mail - uses mime Decoder so mesage must be streamable
  replaceReservedWords: function(dmy, token, arg)	{
    const util = quickFilters.Util,
		      prefs = quickFilters.Preferences;
    let msgDbHdr = util.CurrentMessage,
        hdr = util.CurrentHeader; 
        
    function getNewsgroup() {
      util.logDebugOptional('regularize', 'getNewsgroup()');
      let acctKey = msgDbHdr.accountKey;
      //const account = Components.classes["@mozilla.org/messenger/account-manager;1"].getService(Ci.nsIMsgAccountManager).getAccount(acctKey);
      //dump ("acctKey:"+ acctKey);
      //return account.incomingServer.prettyName;
      return acctKey;
    }
        
	  // calling this function just for logging purposes
		function finalize(tok, s, comment) {
			if (s) {
				let text = "replaceReservedWords( %" + tok + "% ) = " + s;
				if (comment) {
					text += '\n' + comment;
				}
				util.logDebugOptional ('replaceReservedWords', text);
			};
			return s;
		} 
		
		if (!hdr) {
		  let txt = 'Cannot replace token [{1}]\nMessage header not available.';
			util.slideAlert(txt.replace("{1}", token),'replaceReservedWords() failed');
			return "??";
		}
		
    let tm = new Date(),
        date = msgDbHdr.date,
        charset = msgDbHdr.Charset,
		    expand = function(str) { return str.replace(/%([\w-]+)%/gm, util.replaceReservedWords); }

		// time of when original message was sent.
    tm.setTime(date / 1000);

		try {
			switch(token) {
				case "subject":
					let ret = quickFilters.mimeDecoder.decode(hdr.get("subject"), charset);
					return finalize(token, ret);
				case "subjectRegex":
					let subj = quickFilters.mimeDecoder.decode(hdr.get("subject"), charset),
					    regex = new RegExp(arg),
							found = regex.exec(subj),
							sSubject = found.length ? found[0] : ''; // take the first match only
					return finalize(token, sSubject);
				case "newsgroup":
					return finalize(token, getNewsgroup());
				case "identity":
				  /////
					let fullId = identity.fullName + ' <' + identity.email + '>';
					// we need the split to support (name,link) etc.
					token = quickFilters.mimeDecoder.split(fullId, charset, arg, true); // disable charsets decoding!
					break;
				default:
				  if (!hdr.get && prefs.isDebug) debugger;
					let isStripQuote = RegExp(" " + token + " ", "i").test(
					                   " Bcc Cc Disposition-Notification-To Errors-To From Mail-Followup-To Mail-Reply-To Reply-To" +
					                   " Resent-From Resent-Sender Resent-To Resent-cc Resent-bcc Return-Path Return-Receipt-To Sender To "),
              theHeader = hdr.get(token);
          // make sure empty header stays empty for this special case
          if (!theHeader && RegExp(" " + token + " ", "i").test(" Bcc Cc list-id ")) // [Bug 26649] - list-id may not exist
            return '';
					if (isStripQuote) {
						token = quickFilters.mimeDecoder.split(theHeader, charset, arg);
					}
					else {
						token = quickFilters.mimeDecoder.decode(theHeader, charset);
					}
					break;
					// unreachable code! =>
					// token = token.replace(/\r\n|\r|\n/g, ""); //remove line breaks from 'other headers'
			}
		}
		catch(ex) {
			util.logException('replaceReservedWords(dmy, ' + token + ', ' + arg +') failed - unknown token?', ex);
			token="??";
		}
		return token; // this.escapeHtml(token);
	},	
    
	// replaceTerms [ {msgHdr, messageURI} ] - pass message header and message URI replace term variables like %from% %to% etc.
  // fromFilter is a JSON object, not a filter!
	copyTerms: function copyTerms(fromFilter, toFilter, isCopy, oReplaceTerms, isArray, mailsToOmit) {
		const Ci = Components.interfaces,
		      AC = Ci.nsMsgSearchAttrib,
					SearchOP = Ci.nsMsgSearchOp,
          util = quickFilters.Util,
		      prefs = quickFilters.Preferences;
		if (prefs.isDebugOption('createFilter')) debugger;
    
    // convert into an Array
		let stCollection = isArray ? fromFilter.searchTerms : util.querySearchTermsArray(fromFilter.searchTerms),
        TargetTerms = util.querySearchTermsArray(toFilter.searchTerms),
        isBooleanTarget = TargetTerms ? (util.querySearchTermsLength(TargetTerms)>0) : false,
        targetBoolean; // has boolean search terms which may need to be overwritten.
    if (isBooleanTarget) {
      let firstFromTerm = 
        isArray ? stCollection[0] : util.querySearchTermsAt(stCollection, 0);
      
      if (firstFromTerm)
        targetBoolean = firstFromTerm.booleanAnd;
    }
		
    if (oReplaceTerms) {
      if (oReplaceTerms.messageURI) {
        util.CurrentMessage = oReplaceTerms.msgHdr;
        util.CurrentHeader = new quickFilters.clsGetHeaders(oReplaceTerms.messageURI, util.CurrentMessage); 
      }
      else {
        util.popupAlert('Sorry, without messageURI I cannot parse mime headers - therefore cannot replace any variables. Tag listener with custom templates are currently not supported.'); 
        oReplaceTerms = null; // do conventional copy!
      }
    }
		// Iterate Search Terms of Custom Template
		// support passing in a deserialized array from JSON object for reading filters
		let theCount = isArray ? stCollection.length : util.querySearchTermsLength(stCollection);
		for (let t = 0; t < theCount; t++) {
			// let searchTerm = stCollection.GetElementAt(t);
			let searchTerm = isArray ? stCollection[t] : util.querySearchTermsAt(stCollection, t),
			    newTerm;
			if (isCopy) {
			  newTerm = toFilter.createTerm();
				if (searchTerm.attrib || searchTerm.attrib==0) { // [issue 3]
					newTerm.attrib = searchTerm.attrib;
				}
				// nsMsgSearchOpValue
				if (searchTerm.op) newTerm.op = searchTerm.op; 
				if (searchTerm.value) {
				  let val = newTerm.value; // nsIMsgSearchValue
					val.attrib = searchTerm.value.attrib;  
          if (val.attrib==0) {// fix [issue 3]
            newTerm.attrib = 0;
          }
					if (quickFilters.Util.isStringAttrib(val.attrib)) {
            let replaceVal = searchTerm.value.str || ''; // guard against invalid str value. 
            if (oReplaceTerms) {
							if (prefs.isDebugOption('replaceReservedWords')) debugger;
              let newVal = replaceVal.replace(/%([\w-:=]+)(\([^)]+\))*%/gm, util.replaceReservedWords);
              this.logDebugOptional ('replaceReservedWords', replaceVal + ' ==> ' + newVal);
              replaceVal = newVal;
            }
					  val.str = replaceVal;  // .toLocaleString() ?
					}
					else switch (val.attrib) {
					  case AC.Priority:
						  val.priority = searchTerm.value.priority;
							break;
						case AC.MessageKey:
						  val.msgKey = searchTerm.value.msgKey;
							break;
						case AC.AgeInDays:
						  val.age = searchTerm.value.age;
							break;
						case AC.Date:
						  val.date = searchTerm.value.date;
							break;
					  case AC.MsgStatus: 
						  val.status = searchTerm.value.status;
							break;
					  case AC.JunkStatus:
						  val.junkStatus = searchTerm.value.junkStatus;
							break;
					  case AC.Size:
						  val.size = searchTerm.value.size;
							break;
					  case AC.Label:
						  val.label = searchTerm.value.label; // might need special code for copying.
							break;
						case AC.FolderInfo:
						  val.folder = searchTerm.value.folder; // might need special code for copying.
							break;
						case AC.JunkPercent:
						  val.junkPercent = searchTerm.value.junkPercent; 
							break;
					}
					newTerm.value = val;
					
					// append newTerm ONLY if it does not already exist (avoid duplicates!)
					// [Bug 26543] Support gathering address fields from multiple mails:
					if (util.isStringAttrib(val.attrib)) {
						let existingTerms = util.querySearchTermsArray(toFilter.searchTerms),
								isFound = false; 
						for (let e = 0; e < util.querySearchTermsLength(existingTerms); e++) {
							let existingTerm = util.querySearchTermsAt(existingTerms, e),
									existingVal = existingTerm.value; // nsIMsgSearchValue

              if (existingTerm.termAsString == newTerm.termAsString) {
                isFound = true;
                util.logDebug("Custom Template - omitting duplicate term: " + existingTerm.termAsString);
                break;
              }
							else if (existingVal && val.attrib == existingVal.attrib) {
								if (existingVal.str == val.str) { // avoid duplicates
									isFound = true; 
									util.logDebug("Custom Template: omitting duplicate term of type[" + newTerm.value.attrib + "]\n"
									  + "val = " + existingVal.str);
									break;
								}
							}
						}
						if (isFound) continue; // skip this term, as it already exists
						
						if (mailsToOmit) debugger;
						// avoid own addresses when multiple mail is selected
						if (mailsToOmit && 
						    (searchTerm.op == SearchOP.Contains || searchTerm.op == SearchOP.Is || 
								 searchTerm.op == SearchOP.BeginsWith || searchTerm.op == SearchOP.EndsWith)) {
							switch (searchTerm.attrib) {
								case AC.Sender:
								case AC.To:
								case AC.Cc:
								case AC.ToOrCC:
								case AC.AllAddresses:
									if (mailsToOmit.indexOf(val.str)>=0) {
										util.logDebug("Custom Template: omitting own Email Address or Part thereOf: " + val.str + "");
										continue; // omit this one as well.
									}
									// domains
									let domRegex = new RegExp("^(([a-zA-Z]{1})|([a-zA-Z]{1}[a-zA-Z]{1})|([a-zA-Z]{1}[0-9]{1})|([0-9]{1}[a-zA-Z]{1})|([a-zA-Z0-9][a-zA-Z0-9-_]{1,61}[a-zA-Z0-9]))\.([a-zA-Z]{2,6}|[a-zA-Z0-9-]{2,30}\.[a-zA-Z]{2,3})$"),
									    matchedDomain = false;
									if ((searchTerm.op == SearchOP.Contains || searchTerm.op == SearchOP.EndsWith)
										  && domRegex.test(val.str)) {
										for (let d=0; d<mailsToOmit.length; d++) {
											if (mailsToOmit[d].endsWith(val.str)) {
												util.logDebug("Custom Template: omitting own Email Domain: " + val.str + "");
												matchedDomain = true;
												break;
											}
										}
										if (matchedDomain) continue; // omit this one as well.
									}
									break;
								default:
								  break; // carry on
							}
						}
					}
				}
				
        // needs to be changed to the targetFilter format when merging!
        if (isBooleanTarget) {
          newTerm.booleanAnd = targetBoolean; // make sure filter is consistent with target (no mixed any / all)!
        }
        else
          newTerm.booleanAnd = searchTerm.booleanAnd;
        
				if ('arbitraryHeader' in searchTerm) newTerm.arbitraryHeader = new String(searchTerm.arbitraryHeader);
				if ('hdrProperty' in searchTerm) newTerm.hdrProperty = new String(searchTerm.hdrProperty);
				if ('customId' in searchTerm) newTerm.customId = searchTerm.customId;
				newTerm.beginsGrouping = searchTerm.beginsGrouping;
				newTerm.endsGrouping = searchTerm.endsGrouping;
				
			}
			else
			  newTerm = searchTerm;
			// however: this logic is probably not desired if AND + OR are mixed!  (A && B) || (A && C)
			
			toFilter.appendTerm(newTerm);
		}
        // remove special variables
    if (oReplaceTerms) {
      delete (util.CurrentHeader);   
      delete (util.CurrentMessage);
    }
	} ,
	
	getActionCount: function getActionCount(filter) {
    return filter.actionCount;
	} ,
	
	// create a JSON object from a filter
	// pass in nsIMsgFilter
	// uses adapted code from copyTerms and copyActions to build JSON object.
	serializeFilter: function serializeFilter(filter, customErrors) {
		const Ci = Components.interfaces,
					FA = Ci.nsMsgFilterAction,
					AC = Ci.nsMsgSearchAttrib,
					util = quickFilters.Util;
		function isEmpty(v) {
			return (v==="" || v===null);
		}
		let atom = {};
		atom.filterName	= filter.filterName;	
		atom.filterDesc	= filter.filterDesc;	
		atom.filterType = filter.filterType;
		atom.temporary = filter.temporary;
		if (filter.unparseable) atom.unparseable = true;
		atom.actionCount	= filter.actionCount;	
		atom.enabled	= filter.enabled;	
		atom.actionList = [];
		// copy actions
		let actionCount = this.getActionCount(filter);
		for (let a = 0; a < actionCount; a++) {
			let action = filter.getActionAt(a).QueryInterface(Ci.nsIMsgRuleAction);
			// https://dxr.mozilla.org/comm-central/source/obj-x86_64-pc-linux-gnu/dist/include/nsMsgFilterCore.h?q=nsMsgRuleActionType&redirect_type=direct#82
			let atomAction = {};
			atomAction.type = action.type;
			switch(action.type) {
				case FA.ChangePriority:
					atomAction.priority = action.priority;
					break;
				case FA.CopyToFolder:
				case FA.MoveToFolder:
					atomAction.targetFolderUri = action.targetFolderUri;
					break;
				case FA.AddTag:
					atomAction.strValue = action.strValue;
					// atomAction.label = action.label;
					break;
				case FA.JunkScore:
					atomAction.junkScore = action.junkScore;
					break;
				case FA.Custom:
					// note: custom action associated with Id must be set 
					//       prior to reading ac.customAction attribute
					atomAction.customId = action.customId;
					try {
						let cA = action.customAction; // nsIMsgFilterCustomAction
						if (cA) {
							// not quite sure how to fully persist these functions:
							//   (we need to look at where Thunderbird stores them / are they 
							//   part of the filter backup / msgFilterRules.dat?)
							//   specifically, [how] are the methods validateActionValue(), apply() and
							//   isValidForType() implemented / persisted?
							atomAction.customAction = {};
							atomAction.customAction.id = cA.id;
							atomAction.customAction.name = cA.name;
							atomAction.customAction.allowDuplicates = cA.allowDuplicates;
						}
					}
					catch(ex) {
						customErrors.push( { name:filter.filterName, customId: action.customId } );
						util.logToConsole("Filter [" + filter.filterName + "] cannot access customAction with id: " + action.customId + "\n"
						  + "\nSaving id & strValue only.");
					}
					
					break;
			}				
			try {
				if (action.strValue)
					atomAction.strValue = action.strValue;
			}
			catch (ex) {;}
			atom.actionList.push(atomAction);
		}
		
		// 3. iterate all conditions & clone them
		// util.copyTerms(customFilter, targetFilter, true, {"msgHdr": msg, "messageURI": msgUri});
		// [https://bugzilla.mozilla.org/show_bug.cgi?id=857230] convert nsIMsgFilter.idl::searchTerms from nsISupportsArray to something else
		//  searchTerms may have been changed in Thunderbird 58 from nsICollection to nsIMutableArray
		//   this may necessitate a bunch of Shim code.
		// filter.searchTerms.QueryInterface(Components.interfaces.nsIMutableArray); 
		//  	.QueryInterface(Components.interfaces.nsICollection);
		let stCollection = util.querySearchTermsArray(filter.searchTerms); 
		
		atom.searchTerms = [];
		for (let t = 0; t < util.querySearchTermsLength(stCollection); t++) {
			// let searchTerm = stCollection.GetElementAt(t);
			//   stCollection.queryElementAt(t, Components.interfaces.nsIMsgSearchTerm),
			let searchTerm = util.querySearchTermsAt(stCollection, t),
					atomTerm = {};
			if (searchTerm.attrib || searchTerm.attrib==0) {
				atomTerm.attrib = searchTerm.attrib;
			}
			// nsMsgSearchOpValue
			if (searchTerm.op) atomTerm.op = searchTerm.op; 
			if (searchTerm.value) {
				let val = {}; // nsIMsgSearchValue
				val.attrib = searchTerm.value.attrib;  
				if (util.isStringAttrib(val.attrib)) {
					let replaceVal = searchTerm.value.str || '', // guard against invalid str value. 
					    newVal = replaceVal;
          // [issue 105] Backup of Custom Templates (Local Folders) does not store placeholders correctly
          // if (!filter.filterName.startsWith("quickFilterCustomTemplate")) {
          //   newVal = replaceVal.replace(/%([\w-:=]+)(\([^)]+\))*%/gm, util.replaceReservedWords);
          // }
					this.logDebugOptional ('replaceReservedWords', replaceVal + ' ==> ' + newVal);
					replaceVal = newVal;
					val.str = replaceVal;  // .toLocaleString() ?
				}
				else switch (val.attrib) {
					case AC.Priority:
						val.priority = searchTerm.value.priority;
						break;
					case AC.MessageKey:
						val.msgKey = searchTerm.value.msgKey;
						break;
					case AC.AgeInDays:
						val.age = searchTerm.value.age;
						break;
					case AC.Date:
						val.date = searchTerm.value.date;
						break;
					case AC.MsgStatus: 
						val.status = searchTerm.value.status;
						break;
					case AC.JunkStatus:
						val.junkStatus = searchTerm.value.junkStatus;
						break;
					case AC.Size:
						val.size = searchTerm.value.size;
						break;
					case AC.Label:
						val.label = searchTerm.value.label; // might need special code for copying.
						break;
					case AC.FolderInfo:
						val.folder = searchTerm.value.folder; // might need special code for copying.
						break;
					case AC.JunkPercent:
						val.junkPercent = searchTerm.value.junkPercent; 
						break;
				}
				atomTerm.value = val;
			}
			atomTerm.booleanAnd = searchTerm.booleanAnd;
			if ('arbitraryHeader' in searchTerm && !isEmpty(searchTerm.arbitraryHeader)) atomTerm.arbitraryHeader = new String(searchTerm.arbitraryHeader);
			if ('hdrProperty' in searchTerm && !isEmpty(searchTerm.hdrProperty)) atomTerm.hdrProperty = new String(searchTerm.hdrProperty);
			if ('customId' in searchTerm && !isEmpty(searchTerm.customId)) atomTerm.customId = searchTerm.customId;
			atomTerm.beginsGrouping = searchTerm.beginsGrouping;
			atomTerm.endsGrouping = searchTerm.endsGrouping;
			
			// append newTerm ONLY if it does not already exist (avoid duplicates!)
			// however: this logic is probably not desired if AND + OR are mixed!  (A && B) || (A && C)
			atom.searchTerms.push(atomTerm);
		}
		return atom;
	} ,
	
	// initialize a filter object from a JSON
	// pass in the newFilter object, return success boolean
	deserializeFilter: function deserializeFilter(jsonFilter, newFilter) {
		const Ci = Components.interfaces,
					FA = Ci.nsMsgFilterAction,
					AC = Ci.nsMsgSearchAttrib,
					util = quickFilters.Util;
		try {
		let atom = {};
			newFilter.filterName	= jsonFilter.filterName;	
			newFilter.filterDesc	= jsonFilter.filterDesc;	
			newFilter.filterType = jsonFilter.filterType;
			newFilter.temporary = jsonFilter.temporary;
			if (jsonFilter.unparseable) newFilter.unparseable = true;
			// newFilter.actionCount	= jsonFilter.actionCount;	
			newFilter.enabled	= jsonFilter.enabled;	
			
			// add a closured method for retrieving indexed actions
			jsonFilter.getActionAt = function getAction(i) {
				return jsonFilter.actionList[i];
			}
      util.copyActions(jsonFilter, newFilter, false, true);
			
			util.copyTerms(jsonFilter, newFilter, true, null, true);
			
		}
		catch (ex) {
			util.logException(ex, "deserializFilter(" + jsonFilter.filterName +  ")");
			return false;
		}
		return true;
	} ,
	
	
	copyActions: function copyActions(fromFilter, toFilter, suppressTargetFolder, isArray) {
    const Ci = Components.interfaces,
          FA = Ci.nsMsgFilterAction;
		let actionCount = this.getActionCount(fromFilter);
		for (let a = 0; a < actionCount; a++) {
			let act = fromFilter.getActionAt(a),
			    append = true,
			    newActions = toFilter.sortedActionList;
			act = isArray ? act : act.QueryInterface(Ci.nsIMsgRuleAction);
      // don't add dummy action to filter (customTemplate uses set prio=normal as only action)
      if (actionCount==1 
        &&
          act.type == FA.ChangePriority
        && 
          act.priority == Ci.nsMsgPriority.normal) {
          continue;
      }
			// avoid duplicate actions?
			for (let b = 0; b < this.getActionCount(toFilter); b++) { 
				let ac = newActions[b].QueryInterface(Ci.nsIMsgRuleAction);
        /*
          newActions.queryElementAt ?
            newActions.queryElementAt(b, Ci.nsIMsgRuleAction):
            newActions.QueryElementAt(b, Ci.nsIMsgRuleAction);
            */
        // eliminate duplicates
				if (ac.type == act.type
						&& 
						ac.strValue == act.strValue) {
					append = false;
					break;
				}
			}
			
      if (suppressTargetFolder && act.type == FA.MoveToFolder)
        continue; // for custom filter templates, avoids duplicate folder move nonsense
			if (append) {
				let action;
				if (isArray) {
					action = toFilter.createAction(); // nsIMsgRuleAction 
					action.type = act.type;
					switch(act.type) {
						case FA.MoveToFolder: case FA.CopyToFolder:
						  action.targetFolderUri = act.targetFolderUri;
							break;
						case FA.AddTag:
							action.strValue = act.strValue;
							break;
						case FA.ChangePriority:
							action.priority = act.priority;
							break;
						case FA.MarkFlagged:
						case FA.Delete:
						case FA.None:
						case FA.KillThread:
						case FA.KillSubthread:
						case FA.WatchThread:
						case FA.MarkFlagged:
						case FA.MarkUnread:
						case FA.StopExecution:
						case FA.DeleteFromPop3Server:
						case FA.LeaveOnPop3Server:
						  break;
						case FA.Label:
							action.strValue = act.strValue;
							break;
						case FA.JunkScore:
							action.junkScore = act.junkScore;
							break;
						case FA.Custom:
							// note: custom action associated with Id must be set 
							//       prior to reading ac.customAction attribute
							action.customId = act.customId;
							let cA = act.customAction; // nsIMsgFilterCustomAction
							if (cA) {
								// not quite sure how to fully persist these functions:
								//   (we need to look at where Thunderbird stores them / are they 
								//   part of the filter backup / msgFilterRules.dat?)
								//   specifically, [how] are the methods validateActionValue(), apply() and
								//   isValidForType() implemented / persisted?
								if (!action.customAction) {
                  action.customAction = {};
								  action.customAction.id = cA.id;
								  action.customAction.name = cA.name;
								  action.customAction.allowDuplicates = cA.allowDuplicates;
                }
                if (act.hasOwnProperty('strValue'))
                  action.strValue = act.strValue;
							}
						default:
						  if (act.strValue) 
								action.strValue = act.strValue;
					}
					// what about: FA.Forward, FA.Reply, F>.JunkScore
				}
				else {
					action = act;
				}
				toFilter.appendAction(action);
				
			}
		}
	} ,
  
	// returns an Array of "active Email addresses"
	// = mail addresses of default identities only
  getIdentityMailAddresses: function getIdentityMailAddresses() {
    this.logDebug('getIdentityMailAddresses()');
    // make a stop list (my own email addresses)
    let myMailAddresses = [];
		
		quickFilters.Shim.getIdentityMailAddresses(myMailAddresses);
		
    this.logDebugOptional("default", 'getIdentityMailAddresses - retrieved ' + myMailAddresses.length + ' Addresses' );
    return myMailAddresses;
  } ,
  
  extractEmail: function extractEmail(address, domainSwitch) {
    if (!address) return "";
    // filter out only mail portion
    let adp = address.match(/[^@<\s]+@[^@\s>]+/g)[0];
    if (!adp) adp = address
    // regex to strip out the email address
    if (domainSwitch) {
      let at = adp.indexOf('@');
      if (at>0) {
        return adp.substr(at);
      }
    }
    return adp;
  }  ,
  
  filterCustomTemplates: function filterCustomTemplates(attempt) {
    const util = quickFilters.Util;
    attempt++;
    util.logDebugOptional('template.custom','filterCustomTemplates(' + attempt + ')');
    let fWin = util.getLastFilterListWindow(),
        isProcessed = false;
    if (fWin) { 
      let list = fWin.quickFilters.List;
      if (list) {
        list.toggleSearchType('name');
        let searchBox = fWin.document.getElementById("searchBox");
        util.logDebugOptional('template.custom','filterCustomTemplates - searchBox=' + searchBox);
        if (searchBox) {
          searchBox.value = 'quickFilterCustomTemplate';
          isProcessed = true;
          util.logDebugOptional('template.custom','getLastFilterListWindow() calls onFindFilter...');
          list.onFindFilter(false);
        }
      }
    }
    if (!isProcessed) {
      util.logDebugOptional('template.custom','getLastFilterListWindow() not able to process yet...');
      if (attempt<10) {
        window.setTimeout(function() { 
          // debugger;
          const util = quickFilters.Util;
          util.logDebugOptional('template.custom','timeout - filterCustomTemplates(' + attempt + ')..');
          util.filterCustomTemplates(attempt); 
        }, 250);
      }
      else
        util.logDebugOptional('template.custom','Giving up on filtering for custom templates.');
    }
  } ,

  editCustomTemplates: function editCustomTemplates() {
      const util = quickFilters.Util;
      try {
        // we need to select Local Folders
        // and then filter for name "quickFilterCustomTemplate:"
        // see searchFiltersFromFolder
        let win = util.getMail3PaneWindow(),
            localFolder = util.getMsgFolderFromUri('mailbox://nobody@Local%20Folders'),
            qF = win.quickFilters; // , filtersList = localFolder.getEditableFilterList(null)
        qF.Worker.openFilterList(true, localFolder, null, null);
        // only show custom templates, on timeout if not ready
        // we are not using this Util as the originating window will be closed
        qF.Util.filterCustomTemplates(0); 
      } 
      catch (ex) {
        util.logException('editCustomTemplates failed', ex);
      }
  } ,
  
  getFilterList: function getFilterList(folder, win) {
    if (typeof folder.getEditableFilterList === "undefined" || !win)
      return folder.server.getFilterList(null); // Postbox
    return folder.getEditableFilterList(win);
  },
  
  createCustomTemplate: function editCustomTemplates() {
    const Ci = Components.interfaces, 
          Cc = Components.classes,
          nsMsgFilterType = Ci.nsMsgFilterType,    
          nsMsgFilterAction = Ci.nsMsgFilterAction,
          nsMsgPriority = Ci.nsMsgPriority,
          typeAttrib = Ci.nsMsgSearchAttrib,
          typeOperator = Ci.nsMsgSearchOp,
					prefs = quickFilters.Preferences,
					util = quickFilters.Util,
					prompts = Cc["@mozilla.org/embedcomp/prompt-service;1"].getService(Ci.nsIPromptService);
    
    let input = {value: ""},
        check = {value: false},
        promptLabel = util.getBundleString('quickfilters.prompt.customTemplateName', 
                             'Name of Custom Template:'),
        result = prompts.prompt(window, 'quickFilters', promptLabel, input, null, check); 
    if (!result)
      return false;
    else {
      // make new filter
      let filterName = 'quickFilterCustomTemplate: ' + input.value,
          localFolder = util.getMsgFolderFromUri('mailbox://nobody@Local%20Folders'),
          filtersList = util.getFilterList(localFolder),
          filterCount = filtersList.filterCount;
      // make sure it is unique
      for (let i = 0; i < filterCount; i++) {
        let filter = filtersList.getFilterAt(i);
        if (filterName == filter.filterName) {
          let wrn = util.getBundleString('quickfilters.warning.templateNameNotUnique', 
                                         'A filter of this name already exists! It must be unique.');

          util.popupAlert(wrn);
          return false;
        }
      }
      let targetFilter = filtersList.createFilter(filterName);
      // at least one action is necessary!
      let dummyAction = targetFilter.createAction();
      dummyAction.type = nsMsgFilterAction.ChangePriority; 
      dummyAction.priority = nsMsgPriority.normal; // 4
      targetFilter.appendAction(dummyAction);
      let searchTerm = targetFilter.createTerm();
      searchTerm.attrib = typeAttrib.Sender;
      searchTerm.op = typeOperator.Contains;
      // at least one search Term is necessary
      let value = searchTerm.value,
          val = "%from(mail)%";
      value.attrib = searchTerm.attrib;
      value.str = val;
      searchTerm.value = value;
      targetFilter.appendTerm(searchTerm);
      // name it and open editor
      targetFilter.filterType = nsMsgFilterType.Manual;
      targetFilter.filterName = filterName;
      
      filtersList.insertFilterAt(0, targetFilter);
      
      /************************************
        ***  OPEN FILTER RULES DIALOG   ***
        ***********************************
        */
      setTimeout( function() {
        let args = { filter:targetFilter, filterList: filtersList};
        util.getMail3PaneWindow().openDialog("chrome://messenger/content/FilterEditor.xhtml", "",
                          "chrome, modal, resizable,centerscreen,dialog=yes", args);
        if ("refresh" in args && args.refresh) {
          // [Ok]
          if (prefs.getBoolPref("showListAfterCreateFilter")) {
            quickFilters.Worker.openFilterList(true, localFolder, targetFilter);
          }
        }
        else {
          // [Cancel]
          filtersList.removeFilterAt(0);
        }
      } );
      return true;
    }
  } ,
	
  hasPremiumLicense: function hasPremiumLicense() {
    if (!quickFilters.Util.licenseInfo) return false;
    return quickFilters.Util.licenseInfo.status == "Valid";
  } ,
	
	// appends user=pro OR user=proRenew if user has a valid / expired license
	makeUriPremium: function makeUriPremium(URL) {
		const util = quickFilters.Util,
					isPremiumLicense = util.hasPremiumLicense(),
					isExpired = util.licenseInfo.isExpired;
		try {
			let uType = "";
			if (isExpired) 
				uType = "proRenew"
			else if (isPremiumLicense)
			  uType = "pro";
			// make sure we can sanitize all pages for our premium users!
			if (   uType
			    && URL.indexOf("user=")==-1 
					&& URL.indexOf("quickfilters.quickfolders.org")>0 ) {
				// remove #NAMED anchors
				let x = URL.indexOf("#"),
				    anchor = '';
				if (x>0) {
					anchor = URL.substr(x);
					URL = URL.substr(0, x)
				}
				if (URL.indexOf("?")==-1)
					URL = URL + "?user=" + uType;
				else
					URL = URL + "&user=" + uType;
			}
		}
		catch(ex) {
		}
		finally {
			return URL;
		}
	} ,
  
	viewLicense: function viewLicense() {
		let win = quickFilters.Util.getMail3PaneWindow(),
        params = {inn:{mode:"licenseKey",tab:-1, message: "", instance: win.quickFilters}, out:null};
        
		// open options and open the last tab!
    win.openDialog('chrome://quickfilters/content/quickFilters-options.xhtml',
				'quickfilters-options','chrome,titlebar,centerscreen,resizable,alwaysRaised ',
				quickFilters,
				params).focus();
	  
	}, 
	
	viewSupport: function viewSupport() {
		let win = quickFilters.Util.getMail3PaneWindow(),
		    params = {inn:{mode:"supportOnly",tab:-1, message: "", instance: win.quickFilters}, out:null};
    win.openDialog('chrome://quickfilters/content/quickFilters-options.xhtml',
				'quickfilters-options','chrome,titlebar,centerscreen,resizable,alwaysRaised ',
				quickFilters,
				params).focus();
	},

	viewAdvanced: function viewAdvanced() {
		let win = quickFilters.Util.getMail3PaneWindow(),
		    params = {inn:{mode:"advancedOnly",tab:-1, message: "", instance: win.quickFilters}, out:null};
    win.openDialog('chrome://quickfilters/content/quickFilters-options.xhtml',
				'quickfilters-options','chrome,titlebar,centerscreen,resizable,alwaysRaised ',
				quickFilters,
				params).focus();
	} ,
	
	viewFilterProps: function viewFilterProps() {
		let win = quickFilters.Util.getMail3PaneWindow(),
		    params = {inn:{mode:"newFilter",tab:-1, message: "", instance: win.quickFilters}, out:null};
    win.openDialog('chrome://quickfilters/content/quickFilters-options.xhtml',
				'quickfilters-options','chrome,titlebar,centerscreen,resizable,alwaysRaised ',
				quickFilters,
				params).focus();
	},
  
  // helper function to see whether a search condition already exists
  checkExistsTerm: function checkExistsTerm(searchTerms, searchTerm) {
    const util = quickFilters.Util;
    let len = util.querySearchTermsLength(searchTerms);
    for (let i=0; i<len; i++) {
      let t = util.querySearchTermsAt(searchTerms, i);
      if (t.termAsString == searchTerm.termAsString) return true;
    }
    return false;
  } ,
	
	querySearchTermsArray: function querySearchTermsArray(searchTerms) {
		if (searchTerms.QueryElementAt)
			return searchTerms.QueryInterface(Components.interfaces.nsICollection); // old version
		if (searchTerms.queryElementAt)
			return searchTerms.QueryInterface(Components.interfaces.nsIMutableArray);
		return searchTerms; // Tb 87+
	} ,
	
	querySearchTermsAt: function querySearchTermsAt(searchTerms, i) {
		if (searchTerms.QueryElementAt)
			return searchTerms.QueryElementAt(i, Components.interfaces.nsIMsgSearchTerm);
		if (searchTerms.queryElementAt)
			return searchTerms.queryElementAt(i, Components.interfaces.nsIMsgSearchTerm);
		return searchTerms[i]; // Tb 87+
	} ,
  
  querySearchTermsLength: function querySearchTermsLength(searchTerms) {
    if (!searchTerms) return null;
    // old code: Count
    if (searchTerms.Count)
      return searchTerms.Count();
    return searchTerms.length; // Tb 87+
  },
	
  checkCustomHeaderExists: function checkCustomHeaderExists(hdr) {
    // see http://mxr.mozilla.org/comm-central/source/mailnews/base/search/content/CustomHeaders.js#19
    const Ci = Components.interfaces;
    let hdrs = Services.prefs.getCharPref("mailnews.customHeaders"),
        ArrayHdrs;
    if (!hdrs) return 0;
    hdrs = hdrs.replace(/\s+/g,'');  //remove white spaces before splitting
    ArrayHdrs = hdrs.split(":");
    for (let i = 0; i < ArrayHdrs.length; i++)
      if (!ArrayHdrs[i])
        ArrayHdrs.splice(i,1);  //remove any null elements
    for (let i = 0;i < ArrayHdrs.length; i++) {
      if (ArrayHdrs[i] == hdr)
        return i + Ci.nsMsgSearchAttrib.OtherHeader + 1; // custom Header exists, return id 
        // 52 (Tb) is for showing customize - in ui headers start from 53 onwards up until 99.
        // 59 (Pb)
    }
    return 0;
  } ,	
  
  showAboutConfig: function(clickedElement, filter, readOnly) {
    const name = "Preferences:ConfigManager",
		      util = quickFilters.Util,
          Ci = Components.interfaces, 
          Cc = Components.classes;
    let mediator = Services.wm,
        isTbModern = util.versionGreaterOrEqual(util.AppverFull, "85"),
        uri = (isTbModern) ? "about:config": "chrome://global/content/config.xhtml?debug";
    
    let w = mediator.getMostRecentWindow(name),
        win = clickedElement ?
              (clickedElement.ownerDocument.defaultView ? clickedElement.ownerDocument.defaultView : window)
              : window;
    if (!w) {
      let watcher = Cc["@mozilla.org/embedcomp/window-watcher;1"].getService(Ci.nsIWindowWatcher);
      w = watcher.openWindow(win, uri, name, "dependent,chrome,resizable,centerscreen,alwaysRaised,width=750px,height=450px", null);
    }
    w.focus();
    w.addEventListener('load', 
      function () {
        let id = (isTbModern) ? "about-config-search" : "textbox",
            flt = w.document.getElementById(id);
            
        if (flt) {
          flt.value=filter;
          // make filter box readonly to prevent damage!
          if (!readOnly)
            flt.focus();
          else
            flt.setAttribute('readonly',true);
          if (w.self.FilterPrefs) {
            w.self.FilterPrefs();
          }
        }
      });
  },
  
  // moved from the Shim object
  validateFilterTargets: function validateFilterTargets(sourceURI, targetURI) {
    const util = quickFilters.Util,
          Ci = Components.interfaces;
          
    // fix any filters that might still point to the moved folder.
    // 1. nsIMsgAccountManager  loop through list of servers
    try {
                          
      for (let account of util.Accounts) {
        if (account.incomingServer && account.incomingServer.canHaveFilters )
        {
          let ac = account.incomingServer.QueryInterface(Ci.nsIMsgIncomingServer);
          util.logDebugOptional("filters", "checking account for filter changes: " +  ac.prettyName);
          // 2. getFilterList
          let filterList = ac.getFilterList(gFilterListMsgWindow).QueryInterface(Ci.nsIMsgFilterList);
          // 3. use  nsIMsgFilterList.matchOrChangeFilterTarget(oldUri, newUri, false)
          if (filterList) {
            filterList.matchOrChangeFilterTarget(sourceURI, targetURI, false)
          }
        }
      }
    }
    catch(ex) {
      util.logException("Exception in quickFilters.Util.validateFilterTargets ", ex);
    }
  }	,
  
  findFromTargetFolder: function findFromTargetFolder(targetFolder, searchFilterResults) {
    const util = quickFilters.Util,
          Ci = Components.interfaces,
          FA = Ci.nsMsgFilterAction;
            
    try {
      // 1. create a list of matched filters and corresponding accounts 
      //    (these will be linked via index
      for (let account of util.Accounts) {
        if (account.incomingServer && account.incomingServer.canHaveFilters ) {
          let msg ='',
              ac = account.incomingServer.QueryInterface(Ci.nsIMsgIncomingServer),
              // 2. getFilterList
              filtersList = ac.getFilterList(gFilterListMsgWindow).QueryInterface(Ci.nsIMsgFilterList);
          if (filtersList) {
            // build a dictionary of terms; this might take some time!
            let numFilters = filtersList.filterCount;
            util.logDebugOptional("filterSearch", "checking account [" + ac.prettyName + "] "
                                   + "for target folder: " +  targetFolder.URI + '\n'
                                   + "iterating " + numFilters + " filters...");
            for (let idx = 0; idx < numFilters; idx++) {
              let curFilter = filtersList.getFilterAt(idx),
                  actionList = curFilter.sortedActionList,
                  acLength = actionList.length;
              // Match Target Folder by iterating all actions
              for (let index = 0; index < acLength; index++) {
                let action = actionList[index].QueryInterface(Ci.nsIMsgRuleAction);  // qryAt(index, Ci.nsIMsgRuleAction);
                if (action.type == FA.MoveToFolder || action.type == FA.CopyToFolder) {
                  if (action.targetFolderUri) {
                    let isMatch = (action.targetFolderUri === targetFolder.URI),
                        label = isMatch ? "MATCHED URI: " : "Target URI:  ";
                    msg += "[" + idx + "] " + label +  action.targetFolderUri + "\n";
                    if (action.targetFolderUri === targetFolder.URI) { 
                      util.logDebugOptional("filterSearch", "FOUND FILTER MATCH:\n" + curFilter.filterName);
                      searchFilterResults.push (
                        {
                          Filter: curFilter,
                          Account: ac,
                          Action: action
                        }
                      ); // create a new object which contains this trinity
                      break; // only add one action per filter (in case it is duplicated)
                    }
                  }
                }        
              }
              // .. End Match Action Loop
            }       
          }
          util.logDebugOptional("filterSearch.detail", msg);
        }
      }
      util.logDebugOptional("filterSearch", "Matches found: " + searchFilterResults.length);
      
      // 2. Persist in dropdown
      // dropdown with terms
      let filtersDropDown = document.getElementById('quickFiltersFoundResults');
      filtersDropDown.selectedIndex = -1;
      let menuPopup = quickFilters.List.clearFoundFiltersPopup(true);
      
      for (let idx = 0; idx < searchFilterResults.length; idx++) {
        let target = searchFilterResults[idx],
            menuItem = document.createXULElement ? document.createXULElement("menuitem") : document.createElement("menuitem"),
            dec = decodeURI(target.Action.targetFolderUri),
            valueLabel = quickFilters.List.truncateLabel(dec, 30),
            filterIdLabel = target.Filter.filterName;
        if (target.Account.prettyName) {
          filterIdLabel = '[' + target.Account.prettyName + '] ' +  filterIdLabel;
        }
        // let theLabel = filterIdLabel + ' = ' + this.getActionLabel(target.Action.type) + ': ' + valueLabel;
        menuItem.setAttribute("label", filterIdLabel);
        menuItem.targetFilter = target.Filter; 
        menuItem.targetAccount = target.Account;  
        menuItem.setAttribute("actionType", target.Action.type); 
        menuItem.setAttribute("targetFolderUri", target.Action.targetFolderUri);        
        menuPopup.appendChild(menuItem);
      }
      if (searchFilterResults.length) {
        filtersDropDown.collapsed = false;
        // hide duplicates button?
        document.getElementById('quickFiltersBtnDupe').collapsed = true;
        document.getElementById('quickFiltersBtnCancelDuplicates').collapsed = true;
        // show cancel button
        document.getElementById('quickFiltersBtnCancelFound').collapsed = false;
        filtersDropDown.selectedIndex = 0;
      }
      
    }
    catch(ex) {
      util.logException("Exception in quickFilters.Util.findFromTargetFolder ", ex);
    }  
    
  } ,  
  
  // center a window on screen
  centerWindow: function(window) {
    if (!window) return;
    if (window.screenX==0) {
      let dx = window.outerHeight / 2,
          dy = window.outerWidth / 2;
      window.moveTo(window.screen.availWidth/2 - dx,
                    window.screen.availHeight/2 -dy);
      
    }
  } ,
  
  setAssistantButton: function(isActive) {
    let doc = document,
        button = doc.getElementById('quickfilters-toolbar-button');
    if (button) 
      button.checked = isActive;
    let menuItem = doc.getElementById('quickFilters-wizard');
    if (menuItem) {
      menuItem.checked = isActive;
      menuItem.label = quickFilters.Util.getBundleString(
                          isActive ? "quickfilters.FilterAssistant.stop" : "quickfilters.FilterAssistant.start",
                          isActive ? "stop filter assistant" : "start filter assistant");
    }    
  } ,

  showLicenseDialog: function showLicenseDialog(featureName) {
		let params = {
      inn:{
        referrer: featureName, 
        instance: quickFilters   // Why? should this be the main interface? make obsolete!
      }, 
      out:null
    };
    let win = window;
    if (win.closed) { // notifications caused by a close parent window will fail!
      win = quickFilters.Util.getMail3PaneWindow();
    }
    win.openDialog("chrome://quickfilters/content/register.xhtml",
      "quickfilters-register","chrome,titlebar,centerscreen,resizable,alwaysRaised,instantApply",
      quickFilters,
      params).focus();
  } , 
  
  viewSplash: function() {
    quickFilters.Util.notifyTools.notifyBackground({ func: "splashScreen" });
  } ,
  
  // new type of tooltips: click first displays the hovering text in the clickyTooltip attribute!
  openTooltipPopup: function(el) {
    if (el.getAttribute("hasToolTip")) {
      return;
    }
    let txt = el.getAttribute("clickyTooltip");
    if (txt) {
      let tip = document.createElement("div");
      tip.classList.add('tooltip');
      tip.innerText = txt;
      tip.style.transform =
        'translate(' +
          (el.hasAttribute('tip-left') ? 'calc(-100% - 5px)' : '15px') + ', ' +
          (el.hasAttribute('tip-top') ? '-100%' : '0') +
        ')';
      el.appendChild(tip);
      el.onmousemove = e => {
        tip.style.left = e.clientX + 'px'
        tip.style.top = e.clientY + 'px';
      };    
      el.setAttribute("hasToolTip", true);
    }
  },  
	
  dummy: function() {
		/* 
		 *
		 *  END OF QUICKFILTERS.UTIL OBJECT
		 *  ADD NEW ATTRIBUTES ON TOP  ^ ^ ^ 
		 *  ================================================================
		 *  ================================================================
		 */
	}
}; // Util

  // -------------------------------------------------------------------
  // Get header string
  // -------------------------------------------------------------------
quickFilters.clsGetHeaders = function classGetHeaders(messageURI, messageFallbackContent) {
  const Ci = Components.interfaces,
        Cc = Components.classes,
        util = quickFilters.Util,
				prefs = quickFilters.Preferences;
	if (prefs.isDebugOption('createFilter')) debugger;
	
  let messenger = Cc["@mozilla.org/messenger;1"].createInstance(Ci.nsIMessenger),
      messageService = messenger.messageServiceFromURI(messageURI),
      messageStream = Cc["@mozilla.org/network/sync-stream-listener;1"].createInstance().QueryInterface(Ci.nsIInputStream),
      inputStream = Cc["@mozilla.org/scriptableinputstream;1"].createInstance().QueryInterface(Ci.nsIScriptableInputStream);

  util.logDebugOptional('functions','clsGetHeaders(' + messageURI + ')');
  let headers = Cc["@mozilla.org/messenger/mimeheaders;1"].createInstance().QueryInterface(Ci.nsIMimeHeaders);
/*   
  // ASYNC MIME HEADERS

  let testStreamHeaders = true; // new code!
  var asyncUrlListener = new AsyncUrlListener();
  
  if (testStreamHeaders) {
    // http://mxr.mozilla.org/comm-central/source/mailnews/base/public/nsIMsgMessageService.idl#190
    
    // http://mxr.mozilla.org/comm-central/source/mailnews/imap/test/unit/test_imapHdrStreaming.js#101
    let messenger = Components.classes["@mozilla.org/messenger;1"].createInstance(Components.interfaces.nsIMessenger);
    let msgService = messenger.messageServiceFromURI(messageURI); // get nsIMsgMessageService
    msgService.streamHeaders(msgURI, streamListenerST4, asyncUrlListener,true);    
    yield false;
  }
  // ==
  let msgContent = new String(streamListenerST4._data);
  headers.initialize(msgContent, msgContent.length);
*/  
  
  inputStream.init(messageStream);
  try {
    messageService.streamMessage(messageURI, messageStream, msgWindow, null, false, null);
  }
  catch (ex) {
    util.logException('clsGetHeaders - constructor - messageService.streamMessage failed', ex);
    throw ex;
  }

  let msgContent = "",
      contentCache = "";
  try {
    while (inputStream.available()) { 
      msgContent = msgContent + inputStream.read(2048); 
      let p = msgContent.search(/\r\n\r\n|\r\r|\n\n/); //todo: it would be faster to just search in the new block (but also needs to check the last 3 bytes)
      if (p > 0) {
        contentCache = msgContent.substr(p + (msgContent[p] == msgContent[p+1] ? 2 : 4));
        msgContent = msgContent.substr(0, p) + "\r\n";
        break;
      }
      if (msgContent.length > 2048 * 8) {
        util.logDebug('clsGetHeaders - early exit - msgContent length>16kB: ' + msgContent.length);
        return null;
      }
    }
  }
  catch(ex) {
    util.logException('Reading inputStream failed:', ex);
    if (!msgContent && !messageFallbackContent) throw(ex);
  }
	
	if (msgContent.length==0) {
		headers = null;
		util.logDebugOptional('mime','Could not stream message, using fallback contents instead.');
	}
  else {
		headers.initialize(msgContent, msgContent.length);
		util.logDebugOptional('mime','allHeaders: \n' +  headers.allHeaders);
  }
	

  // -----------------------------------
  // Get header
  function get(header) {
    // /nsIMimeHeaders.extractHeader
		// See ST4.clsGetAltHeader
		if (!headers) {
			switch(header) {
				case "from": 
				  header="author";
					break;
				case "to":
					header = "recipients";
					break;
			}
		}
		
    let retValue = '',
        str = headers ? headers.extractHeader(header, false) : messageFallbackContent[header],
        isUnescapeQuotes = false;
				
				
    // for names maybe use nsIMsgHeaderParser.extractHeaderAddressName instead?
    if (str && isUnescapeQuotes) {
      // if a string has nested escaped quotes in it, should we unescape them?
      // "Al \"Karsten\" Seltzer" <fxxxx@gmail.com>
      retValue = str.replace(/\\\"/g, "\""); // unescape
    }
    else
      retValue = str ? str : "";
    return retValue;
  };
  
  // -----------------------------------
  // Get content
  /*
  function content(size) {
    while (inputStream.available() && contentCache.length < size) 
      contentCache += inputStream.read(2048);
    if (contentCache.length > size) return contentCache.substr(0, size);
    else return contentCache;
  };*/

  // -----------------------------------
  // Public methods
  this.get = get;
  // this.content = content;
  return null;    
} ; // quickFilters.clsGetHeaders


quickFilters.mimeDecoder = {
	headerParam: Components
	             .classes["@mozilla.org/network/mime-hdrparam;1"]
	             .getService(Components.interfaces.nsIMIMEHeaderParam),

	// -----------------------------------
	// Detect character set
	// jcranmer: this is really impossible based on such short fields
	// see also: hg.mozilla.org/users/Pidgeot18_gmail.com/patch-queues/file/cd19874b48f8/patches-newmime/parser-charsets
	//           http://encoding.spec.whatwg.org/#interface-textdecoder
	//           
	detectCharset: function mime_detectCharset(str) {
		let charset = "", 
        util = quickFilters.Util;
		 // not supported                  
		 // #    RFC1555 ISO-8859-8 (Hebrew)
		 // #    RFC1922 iso-2022-cn-ext (Chinese extended)

		if (str.search(/\x1b\$[@B]|\x1b\(J|\x1b\$\(D/gi) !== -1) {   // RFC1468 (Japanese)
		  charset = "iso-2022-jp"; 
		} 
		if (str.search(/\x1b\$\)C/gi) !== -1)                    {   // RFC1557 (Korean)
		  charset = "iso-2022-kr"; 
		} 
		if (str.search(/~{/gi) !== -1)                           {   // RFC1842 (Chinese ASCII)
		  charset = "HZ-GB-2312"; 
		}
		if (str.search(/\x1b\$\)[AG]|\x1b\$\*H/gi) !== -1)       {   // RFC1922 (Chinese) 
		  charset = "iso-2022-cn"; 
		}
		if (str.search(/\x1b\$\(D/gi) !== -1) {  // RFC2237 (Japanese 1)
		  charset = "iso-2022-jp-1"; 
		}
		if (!charset) { 
			let defaultSet = "ISO-8859-1"; 
			charset = defaultSet ? defaultSet : '';  // should we take this from Thunderbird instead?
		}
		util.logDebugOptional('mime','mimeDecoder.detectCharset guessed charset: ' + charset +'...');
		return charset;
	},

	// -----------------------------------
	// MIME decoding.
	decode: function mime_decode(theString, charset) {
		let decodedStr = "";

		try {
			if (/=\?/.test(theString)) {
				// RFC2231/2047 encoding.
				// We need to escape the space and split by line-breaks,
				// because getParameter stops convert at the space/line-breaks.
        // => some russian mail servers use tab character as delimiter
        //    some even use a space character between 2 encoding blocks
        theString = theString.replace ("?= =?", "?=\n=?"); // space problem
				let array = theString.split(/\s*\r\n\s*|\s*\r\s*|\s*\n\s*|\s*\t\s*/g);
				for (let i = 0; i < array.length; i++) {
					decodedStr += this.headerParam
					                  .getParameter(array[i].replace(/%/g, "%%").replace(/ /g, "-%-"), null, charset, true, { value: null })
					                  .replace(/-%-/g, " ").replace(/%%/g, "%");
				}
			}
			else {
        util.logDebug("Mailer has no manners, trying to decode string: " + theString);
        decodedStr = decodeURIComponent(escape(theString));
        util.logDebug("...decoded string: " + decodedStr);
			}
		}
		catch(ex) {
			quickFilters.Util.logDebugOptional('mime','mimeDecoder.decode(' + theString + ') failed with charset: ' + charset
			    + '...\n' + ex);
			return theString;
		}
		return decodedStr;
	} ,

	// -----------------------------------
	// Split addresses and change encoding.
  // addrstr - comma separated string of address-parts
  // charset - character set of target string (probably silly to have one for all)
  // format - list of parts for target string: name, firstName, lastName, mail, link, bracketMail()
	split: function mime_split(addrstr, charset, format, bypassCharsetDecoder)	{
    let util = quickFilters.Util
	  // jcranmer: you want to use parseHeadersWithArray
		//           that gives you three arrays
	  //           the first is an array of strings "a@b.com", "b@b.com", etc.
		//           the second is an array of the display names, I think fully unquoted
    //           the third is an array of strings "Hello <a@b.com>"
		//           preserveIntegrity is used, so someone with the string "Dole, Bob" will have that be quoted I think
		//           if you don't want that, you'd have to pass to unquotePhraseOrAddrWString(value, false)
		//           oh, and you *don't* need to decode first, though you might want to
		// see also: https://bugzilla.mozilla.org/show_bug.cgi?id=858337
		//           hg.mozilla.org/users/Pidgeot18_gmail.com/patch-queues/file/587dc0232d8a/patches-newmime/parser-tokens#l78
		// use https://developer.mozilla.org/en-US/docs/XPCOM_Interface_Reference/nsIMsgDBHdr
		// mime2DecodedAuthor, mime2DecodedSubject, mime2DecodedRecipients!
	  function _getEmailAddress(a) {
			return a.replace(/.*<(\S+)>.*/g, "$1");
		}

		function _isLastName(format) { return (format.search(/^\(lastname[,\)]/, "i") != -1); };
    function _getBracketAddressArgs(format) { 
      let reg = /bracketMail\[(.+?)\]/g, // we have previously replaced bracketMail(*) with bracketMail[*] !
          ar = reg.exec(format);
      if (ar && ar.length>1)
        return ar[1];
      return '';
    };
    function _getCardFromAB(mail) {
      if (!mail) return null;
      // https://developer.mozilla.org/en-US/docs/Mozilla/Thunderbird/Address_Book_Examples
      // http://mxr.mozilla.org/comm-central/source/mailnews/addrbook/public/nsIAbCard.idl
      
      let abManager = Components.classes["@mozilla.org/abmanager;1"].getService(Components.interfaces.nsIAbManager),
        allAddressBooks = abManager.directories; 
      while (allAddressBooks.hasMoreElements()) {
        let addressBook = allAddressBooks.getNext()
                                         .QueryInterface(Components.interfaces.nsIAbDirectory);
        if (addressBook instanceof Components.interfaces.nsIAbDirectory) { // or nsIAbItem or nsIAbCollection
          // alert ("Directory Name:" + addressBook.dirName);
          try {
            let card = addressBook.cardForEmailAddress(mail);
            if (card)
              return card;
          }
          catch(ex) {
            util.logDebug('Problem with Addressbook: ' + addressBook.dirName + '\n' + ex) ;
          }
        }
      }
      return null;
    }

    // return the bracket delimiteds
		function _getBracketDelimiters(element) {
      let del1='', del2='',
          bracketExp = element.field;
      if (bracketExp) {
        // bracketMail()% use to "wrap" mail address with non-standard characters
        // bracketMail(square)%    [email]  - square brackets
        // bracketMail(round)%     (email)   - round brackets
        // bracketMail(angle)%     <email>   - angled brackets
        // bracketMail(;)%      email
        // bracketMail(<;>)%    <email>
        // bracketMail(";")%    "email"
        // bracketMail(= ;)%     = email
        // etc.
        // the expression between brackets can also have empty delimiters; e.g. bracketMail(- ;) will prefix "- " and append nothing
        // we use ; as delimiter between the bracket expressions to avoid wrongly splitting format string elsewhere
        // (Should we allow escaped round brackets?)
        if (!bracketParams.trim())
          bracketParams = 'angle';
        let delimiters = bracketParams.split(';');
        switch(delimiters.length) {
          case 0: // error
            break;
          case 1: // special case
            switch(delimiters[0]) {
              case 'square':
                del1 = '[';
                del2 = ']';
                break;
              case 'round':
                del1 = '(';
                del2 = ')';
                break;
              case 'angle': case 'angled':
                del1 = '<'; // <
                del2 = '>';  // >
                break;
              default:
                del1 = '?';
                del2 = '?';
            }
            break;
          default: // delimiters separated by ; 3 and more are ignored.
            del1 = delimiters[0];
            del2 = delimiters[1];
            break;
        }
      }
      return [del1, del2];
    }
    
    //  %from% and %to% default to mail only for filtering
    if (typeof format=='undefined' || format == '') {
      format = 'mail'; 
    }
    
		util.logDebugOptional('mime.split',
         '====================================================\n'
       + 'mimeDecoder.split(charset decoding=' + (bypassCharsetDecoder ? 'bypassed' : 'active') + ')\n'
       + '  addrstr:' +  addrstr + '\n'
       + '  charset: ' + charset + '\n'
       + '  format: ' + format + '\n'
       + '====================================================');
		// if (!bypassCharsetDecoder)
			// addrstr = this.decode(addrstr, charset);
		// Escape % and , characters in mail addresses
		addrstr = addrstr.replace(/"[^"]*"/g, function(s){ return s.replace(/%/g, "%%").replace(/,/g, "-%-"); });
		util.logDebugOptional('mime.split', 'After escaping special chars in mail address field:\n' + addrstr);

    /** SPLIT ADDRESSES **/
		let array = addrstr.split(/\s*,\s*/);
    
    /** SPLIT FORMAT PLACEHOLDERS **/
		// possible values for format are:
		// name, firstname, lastname, mail - fields (to be extended)
    // bracketMail(args) - special function (we replaced the round brackets with [] for parsing)
    // link, islinkable  - these are "modifiers" for the previous list element
    let formatArray = [];
    if (format) {
      // remove parentheses
      if (format.charAt(0)=='(')
        format = format.slice(1);
      if (format.charAt(format.length-1)==')')
        format = format.slice(0, -1);
      
      let fs=format.split(',');
      for(let i=0; i<fs.length; i++) {
        let ff = fs[i].trim();
        // if next one is a link modifier, modify previous element and continue
        switch(ff.toLowerCase()) {
          case 'link':
            formatArray[formatArray.length-1].modifier = 'linkTo';
            continue;
          case 'islinkable':
            formatArray[formatArray.length-1].modifier = 'linkable';
            continue;
        }
        formatArray.push ({ field: ff, modifier: ''}); // modifier: linkTo
      }
    }
    
    let dbgText = 'addrstr.split() found [' + array.length + '] addresses \n' + 'Formats:\n';
    for (let i=0; i<formatArray.length; i++) {
      dbgText += formatArray[i].field;
      if (formatArray[i].modifier)  
        dbgText += '(' + formatArray[i].modifier + ')';
      dbgText += '\n';
    }
    util.logDebugOptional('mime.split', dbgText);
    
		let addresses = "",
        address,
        bracketParams = _getBracketAddressArgs(format); 

    /** ITERATE ADDRESSES  **/
		for (let i = 0; i < array.length; i++) {
			if (i > 0) {
				addresses += ", ";
			}
      let addressee = '',
          firstName = '', 
          lastName = '',
          fullName = '',
          emailAddress = '',
          addressField = array[i];
      // [Bug 25816] - missing names caused by differing encoding
      // MIME decode (moved into the loop)
      if (!bypassCharsetDecoder)
        addressField = this.decode(array[i], charset);
      
			// Escape "," in mail addresses
			array[i] = addressField.replace(/\r\n|\r|\n/g, "")
			                   .replace(/"[^"]*"/,
			                   function(s){ return s.replace(/-%-/g, ",").replace(/%%/g, "%"); });
			// name or/and address
			address = array[i].replace(/^\s*([^<]\S+[^>])\s*$/, "<$1>").replace(/^\s*(\S+)\s*\((.*)\)\s*$/, "$2 <$1>");
      
      util.logDebugOptional('mime.split', 'processing: ' + addressField + ' => ' + array[i] + '\n'
                                           + 'address: ' + address);
      // [Bug 25643] get name from Addressbook
      emailAddress = _getEmailAddress(address); // get this always
      // this cuts off the angle-bracket address part: <fredflintstone@fire.com>
      addressee = address.replace(/\s*<\S+>\s*$/, "")
                      .replace(/^\s*\"|\"\s*$/g, "");  // %to% / %to(name)%
      if (!addressee) { // if no addressee part found we probably have only an email address.; take first part before the @
        addressee = address.slice(0, address.indexOf('@'));
        if (addressee.charAt('0')=='<')
          addressee = addressee.slice(1);
      }
      // if somebody repeats the email address instead of a name at front, e.g. a.x@tcom, we cut the domain off anyway
      if (addressee.indexOf('@')>0)
        addressee = addressee.slice(0, addressee.indexOf('@'));
			fullName = addressee.trim();
      
      let names = fullName.split(' '),
          isOnlyOneName = (names.length==1) ? true : false;
      if (!firstName) firstName = (names.length) ? names[0] : '';
      if (!lastName) lastName = (names.length>1) ? names[names.length-1] : '';
      
      // build the part!
      addressField = ""; // reset to finalize
      let fullDomain = emailAddress.substring(emailAddress.indexOf("@")+1);
      for (let j=0; j<formatArray.length; j++)  {
        let element = formatArray[j],
            part = ""; 
        switch(element.field.toLowerCase()) {
          case "mail":
            part = emailAddress;
            break;
          case "name":
            if (fullName)
              part = fullName;
            else
              part = address.replace(/.*<(\S+)@\S+>.*/g, "$1"); // email first part fallback
            break;
          case "firstname":
            part = firstName;
            break;
          case "domain": // cut off "name@" to retrieve only domain portion of mail
            part = fullDomain;
            break;
          case "domain.root": // cut off extension(s) of domain
            {
              let parts = fullDomain.split(".");
              let extensionCount = 0;
              for (i=parts.length-1; i>0; i--) {
                extensionCount++;
                if (extensionCount==1) {
                  parts.pop(i);
                } 
                else if (i>1) {
                  if (parts[i].length<=3) { // just a guess
                    parts.pop(i);
                  }
                  else { i=0 ; } // end loop (avoiding break)
                }
              }
              part = parts[parts.length-1]; // last part of list!              
            }
            break;
          case "domain.subdomain": // cut off "name@" to retrieve only domain portion of mail
            {
              let match = /^([^.]+)/.exec(fullDomain);
              part = match.length>1 ? match[1] : "";  // no subdomain found
            }
            break;
          case "domain.extension": // only use extension(s). actually hard to do without a database
            {
              let parts = fullDomain.split(".");
              let extensionCount = 0;
              let extensions = [];
              for (i=parts.length-1; i>0; i--) {
                extensionCount++;
                if (extensionCount==1) {
                  extensions.push(parts.pop(i));
                } 
                else if (i>1) {
                  if (parts[i].length<=3) { // just a guess
                    extensions.push(parts.pop(i));
                  }
                  else { i=0 ; } // end loop (avoiding break)
                }
              }
              part = extensions.reverse().join(".");      
            }
            break;
          case "lastname":
            if (isOnlyOneName && format.indexOf("firstname")<0) {
              part = firstName; // fall back to first name if lastName was 
                                // "emptied" because of duplication
            }
            else
              part = lastName;
            break;
          default:
            if (element.field.indexOf("bracketMail[")==0) {
              let open, close;
              [open, close] = _getBracketDelimiters(element);
              part = emailAddress ? open + emailAddress + close : "";
            }
            break;
        }
        if (element.modifier =="linkTo") {
          part = "<a href=mailto:" + emailAddress + ">" + part + "</a>"; // mailto
        }

        // append the next part
        if (part.length>1) {
          // space to append next parts
          if(j) addressField += ' ';
          addressField += part;
        }
      }
      
      util.logDebugOptional("mime.split", "adding formatted address: " + addressField);
      addresses += addressField;
		}
		return addresses;
	} // split
};  // quickFilters.mimeDecoder



/*** Code moved from chimEcma/qFilters-shim-ecma.js  ===> **/
var {Services} = ChromeUtils.import('resource://gre/modules/Services.jsm');
	
if (!quickFilters.Util.Accounts) {
	Object.defineProperty(quickFilters.Util, "Accounts",
    { get: function() {
        var { MailServices } = ChromeUtils.import("resource:///modules/MailServices.jsm"); // replace account-manager
        
        let acMgr = MailServices.accounts,
            aAccounts = [];
            
        for (let ac of acMgr.accounts) {
          aAccounts.push(ac);
        };
        return aAccounts;
      }
    }
  );
}

if (!quickFilters.Shim) {
	quickFilters.Shim = {
		
		getIdentityMailAddresses: function getIdentityMailAddresses(MailAddresses) {
			const util = quickFilters.Util;
													
			for (let account of util.Accounts) {
				try {
					let idMail = '';
					if (account.defaultIdentity) {
						idMail = account.defaultIdentity.email;
					}
					else if (account.identities.length) {
						idMail = account.identities[0].email; // outgoing identities
					}
					else {
						util.logDebug('getIdentityMailAddresses() found account without identities: ' + account.key);
					}
					if (idMail) {
						idMail = idMail.toLowerCase();
						if (idMail && MailAddresses.indexOf(idMail)==-1) 
							MailAddresses.push(idMail);
					}
				}
				catch(ex) {
					util.logException ('getIdentityMailAddresses()', ex);
				}
			}
		} ,

		cloneHeaders: function cloneHeaders(msgHdr, messageClone, dbg, appendProperty) {
			// Object.entries does not exist before Platform==47
			for (let [propertyName, prop] of Object.entries(msgHdr)) {
				// propertyName is what you want
				// you can get the value like this: myObject[propertyName]
				try {
					let hasOwn = msgHdr.hasOwnProperty(propertyName),
							isCopied = false;  // replace msgHdr[propertyName] with prop
					if (hasOwn && typeof prop != "function" && typeof prop != "object") {
						messageClone[propertyName] = msgHdr[propertyName]; // copy to the clone!
						if (messageClone[propertyName])  // make sure we have some data! (e.g. author, subject, recipient, date, charset, messageId)
							dbg.countInit ++;
						isCopied = true;
					}
					if (isCopied) {
						dbg.test = appendProperty(dbg.test, msgHdr, propertyName);
					}
					else {
						dbg.test2 = appendProperty(dbg.test2, msgHdr, propertyName);
					}
				}
				catch(ex) { ; }
			}
		} ,
		
		findInboxFromRoot: function findInboxFromRoot(root, fflags) {
			const Ci = Components.interfaces,
			      util = quickFilters.Util;
/*			if (typeof ChromeUtils.import == "undefined")
				Components.utils.import("resource:///modules/iteratorUtils.jsm");
			else
				var { fixIterator } = ChromeUtils.import("resource:///modules/iteratorUtils.jsm"); */
						
			for (let folder of root.subFolders) {  // fixIterator(, Ci.nsIMsgFolder)
				if (folder.getFlag && folder.getFlag(fflags.Inbox) || folder.getFlag(fflags.Newsgroup)) {
					util.logDebugOptional('createFilter', "sourceFolder: determined Inbox " + folder.prettyName);
					return folder;
				}
			}
			return null;
		} ,
		
		dummy: ", <== end Shim properties here"
	} // end of Shim definition
};
/*** <<<===== END Code moved from chimEcma/qFilters-shim-ecma.js  **/


// the following adds the notifyTools API as a util method to communicate with the background page
// this mechanism will be used to replace legacy code with API calls.
var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
var { ExtensionParent } = ChromeUtils.import("resource://gre/modules/ExtensionParent.jsm");
quickFilters.Util.extension = ExtensionParent.GlobalManager.getExtension("quickFilters@axelg.com");
Services.scriptloader.loadSubScript(
  quickFilters.Util.extension.rootURI.resolve("chrome/content/scripts/notifyTools.js"),
  quickFilters.Util,
  "UTF-8"
);
