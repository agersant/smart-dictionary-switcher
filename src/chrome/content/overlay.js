function debug (message) {
  var consoleService = Components.classes["@mozilla.org/consoleservice;1"].getService(Components.interfaces.nsIConsoleService);
  consoleService.logStringMessage("agersant: " + message);
}

var MIN_WORDS_LIMIT = 20; 				//Min number of words considered for language detection
var MAX_WORDS_LIMIT = 50; 				//Max number of words considered for language detection
var MIN_RATIO_OF_CORRECT_WORDS = .5; 	//Minimum ratio of correctly spelled word required for a dictionary to be considered a good candidate (useful if we are writing in a language without a matching dictionary installed)

var dictionaries = {};					//List of available dictionaries
var editor;								//Text editor in the compose window
var currentDictionaryIndex = 0;			//Index of the dictionary currently being probed
var archives = [];						//Array of AnalysisResult telling us how well dictionaries performed against their latest word set.
var bestDictionary = "";				//Name of the best dictionary we have found
var bestScore = MAX_WORDS_LIMIT + 1;	//Number of misspelled words using our best dictionary

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

function work () {

	//No dictionaries -> no work!
	if (dictionaries.length == 0) return;
	
	//Retrieve email text
	var text = editor.outputToString('text/plain', 4);
	text = text.replace(/[\u0021-\u0040\u005B-\u0060]/g, " ");	//Remove basic punctuation
	var words = text.split(/\s+/, MAX_WORDS_LIMIT);				//Split into words
	
	//Give up if we do not have enough words
	if (words.length < MIN_WORDS_LIMIT) return;
		
	//Move on to next dictionary
	currentDictionaryIndex = (currentDictionaryIndex + 1)%dictionaries.length;
	var currentDictionary = dictionaries[currentDictionaryIndex];
	
	//Skip analysis if word pool hasnt changed
	var doAnalysis = true;
	var archive = archives[currentDictionaryIndex];
	if (archive != undefined)
		doAnalysis = archive.needsComparisonAgainst(words);
	
	//Evaluate dictionary if needed
	var score;
	if (doAnalysis) {
		debug("Analyzing " + currentDictionary);
		spellCheckEngine.dictionary = currentDictionary;
		score = 0;
		for (var w = 0 ; w < words.length ; w++)
			if (!spellCheckEngine.check(words[w]))
				score++;
		archives[currentDictionaryIndex] = new AnalysisResult(words, score);		
	} else score = archive.score;
	
	//Check if this was our best candidate so far
	debug(currentDictionary + ":" + score + " vs " + bestDictionary + ":" + bestScore);
	if (score < bestScore || bestDictionary == currentDictionary) {
		bestScore = score;
		bestDictionary = currentDictionary;
	}
	
	//Check if this dictionary is good enough for being used
	var misspellRatio = score / words.length;
	var shitRresult = misspellRatio > (1 - MIN_RATIO_OF_CORRECT_WORDS);
	if (shitRresult && bestDictionary == currentDictionary)	bestDictionary = "";
	
	//Change dictionary according to result
	var activeDictionary = editor.getInlineSpellChecker(true).spellChecker.GetCurrentDictionary();
	if (activeDictionary != bestDictionary) {
		editor.getInlineSpellChecker(true).spellChecker.SetCurrentDictionary(bestDictionary);
		debug("Dictionary set to " + bestDictionary);
	}
	
}

function populateDictionaries () {

	//Get spellchecking engine
	var spellclass = "@mozilla.org/spellchecker/myspell;1";
	if ("@mozilla.org/spellchecker/hunspell;1" in Components.classes)
		spellclass = "@mozilla.org/spellchecker/hunspell;1";
	if ("@mozilla.org/spellchecker/engine;1" in Components.classes)
		spellclass = "@mozilla.org/spellchecker/engine;1";	
	spellCheckEngine = Components.classes[spellclass].createInstance(Components.interfaces.mozISpellCheckingEngine);
	
	//Populate dictionaries from spellchecking engine
	spellCheckEngine.getDictionaryList(dictionaries, {});
	dictionaries = dictionaries.value;
	
}

var myStateListener = {
	NotifyComposeBodyReady: function() {	
		populateDictionaries();
		editor = GetCurrentEditor();	
		window.setInterval(work, 2000);		
	}
}

window.addEventListener("compose-window-init", function(e) {
   gMsgCompose.RegisterStateListener(myStateListener);
}, true);