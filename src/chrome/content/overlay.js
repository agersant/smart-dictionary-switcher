function debug (message) {
  var consoleService = Components.classes["@mozilla.org/consoleservice;1"].getService(Components.interfaces.nsIConsoleService);
  consoleService.logStringMessage("agersant: " + message);
}

var MIN_RATIO_OF_CORRECT_WORDS = .5; 	//Minimum ratio of correctly spelled word required for a dictionary to be considered a good candidate (useful if we are writing in a language without a matching dictionary installed)
function AnalysisResult (words, score) {
	this.wordSet = words;
	this.score = score;
	this.needsComparisonAgainst = function (newWords) {
		if (newWords.length != this.wordSet.length)
			return true;
		for (var w = 0 ; w < this.wordSet.length ; w++)
			if (this.wordSet[w] != newWords[w])
				return true;
		return false;
	}
}

var SmartDictionarySwitcher = {
	prefs: null
,	setIntervalID: null
,	spellCheckEngine: null				//Spellcheck engine
,	editor: null						//Text editor in the compose window
,	dictionaries: {}					//List of available dictionaries
,	currentDictionaryIndex: 0			//Index of the dictionary currently being probed
,	archives: []						//Array of AnalysisResult telling us how well dictionaries performed against their latest word set.
,	bestDictionary: ""					//Name of the best dictionary we have found
,	bestScore: 0						//Number of misspelled words using our best dictionary //TODO init
,	getMaxWords: function () {
		return Math.max(1, this.prefs.getIntPref("maxWords"));
	}
,	getMinWords: function () {
		return this.prefs.getIntPref("minWords");
	}

,	startup: function () {
		//Get preferences
		this.prefs = Components.classes["@mozilla.org/preferences-service;1"]
			.getService(Components.interfaces.nsIPrefService)
			.getBranch("extensions.smartdictionartswitcher.");
		this.prefs.QueryInterface(Components.interfaces.nsIPrefBranch2);
		this.prefs.addObserver("", this, false);
		this.bestScore = this.getMaxWords() + 1;
		//Retrieve dictionaries and editor
		this.populateDictionaries();
		this.editor = GetCurrentEditor();
		//Begin work!
		this.initWorker();
	}

,	shutdown: function() {
		this.prefs.removeObserver("", this);
	}

,	observe: function(subject, topic, data) {
		if (topic != "nsPref:changed") return;
		switch (data) {
			case "checkPeriod":
				SmartDictionarySwitcher.initWorker();
				break;
		}
	}

,	initWorker: function () {
		debug("init w/ " + this.prefs.getIntPref("checkPeriod"));
		window.clearInterval(this.setIntervalID);
		this.setIntervalID = window.setInterval(this.work, this.prefs.getIntPref("checkPeriod") * 1000);
	}

,	populateDictionaries: function () {
		//Get spellchecking engine
		var spellclass = "@mozilla.org/spellchecker/myspell;1";
		if ("@mozilla.org/spellchecker/hunspell;1" in Components.classes)
			spellclass = "@mozilla.org/spellchecker/hunspell;1";
		if ("@mozilla.org/spellchecker/engine;1" in Components.classes)
			spellclass = "@mozilla.org/spellchecker/engine;1";
		this.spellCheckEngine = Components.classes[spellclass].createInstance(Components.interfaces.mozISpellCheckingEngine);
		//Populate dictionaries from spellchecking engine
		this.spellCheckEngine.getDictionaryList(this.dictionaries, {});
		this.dictionaries = this.dictionaries.value;
	}

,	work: function () {

		//Only work in active window
		if (!SmartDictionarySwitcher.editor.document.hasFocus()) return;

		//Read preferences
		var minWords = SmartDictionarySwitcher.getMinWords();
		var maxWords = SmartDictionarySwitcher.getMaxWords();

		//No dictionaries -> no work!
		if (SmartDictionarySwitcher.dictionaries.length == 0) return;

		//Retrieve email text
		var text = SmartDictionarySwitcher.editor.outputToString('text/plain', 4);
		text = text.replace(/[\u0021-\u0040\u005B-\u0060]/g, " ");	//Remove basic punctuation
		var words = text.split(/\s+/, maxWords);					//Split into words

		//Give up if we do not have enough words
		if (words.length < minWords) return;

		//Move on to next dictionary
		SmartDictionarySwitcher.currentDictionaryIndex = (SmartDictionarySwitcher.currentDictionaryIndex + 1)%SmartDictionarySwitcher.dictionaries.length;
		var currentDictionary = SmartDictionarySwitcher.dictionaries[SmartDictionarySwitcher.currentDictionaryIndex];

		//Skip analysis if word pool hasnt changed
		var doAnalysis = true;
		var archive = SmartDictionarySwitcher.archives[SmartDictionarySwitcher.currentDictionaryIndex];
		if (archive != undefined)
			doAnalysis = archive.needsComparisonAgainst(words);

		//Evaluate dictionary if needed
		var score;
		if (doAnalysis) {
			SmartDictionarySwitcher.spellCheckEngine.dictionary = currentDictionary;
			score = 0;
			for (var w = 0 ; w < words.length ; w++)
				if (!SmartDictionarySwitcher.spellCheckEngine.check(words[w]))
					score++;
			SmartDictionarySwitcher.archives[SmartDictionarySwitcher.currentDictionaryIndex] = new AnalysisResult(words, score);
		} else score = archive.score;

		//Check if this was our best candidate so far
		if (score < SmartDictionarySwitcher.bestScore || SmartDictionarySwitcher.bestDictionary == currentDictionary) {
			SmartDictionarySwitcher.bestScore = score;
			SmartDictionarySwitcher.bestDictionary = currentDictionary;
		}

		//Check if this dictionary is good enough for being used
		var misspellRatio = score / words.length;
		var shitRresult = misspellRatio > (1 - MIN_RATIO_OF_CORRECT_WORDS);
		if (shitRresult && SmartDictionarySwitcher.bestDictionary == currentDictionary) SmartDictionarySwitcher.bestDictionary = "";

		//Change dictionary according to result
		var activeDictionary = SmartDictionarySwitcher.editor.getInlineSpellChecker(true).spellChecker.GetCurrentDictionary();
		if (activeDictionary != SmartDictionarySwitcher.bestDictionary)
			SmartDictionarySwitcher.editor.getInlineSpellChecker(true).spellChecker.SetCurrentDictionary(SmartDictionarySwitcher.bestDictionary);
	}

}

var myStateListener = {
	NotifyComposeBodyReady: function() {
		SmartDictionarySwitcher.startup();
	}
}

window.addEventListener("compose-window-init", function(e){ gMsgCompose.RegisterStateListener(myStateListener); }, true);
window.addEventListener("compose-window-close", function(e){ SmartDictionarySwitcher.shutdown(); }, true);