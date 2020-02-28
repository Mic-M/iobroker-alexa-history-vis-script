/******************************************************************************************************
 * History der Sprachbefehle in VIS darstellen.
 * ------------------------------------------------------------------------------- 
 * Dieses Script sammelt die "Alexa History Summary", also alle an Alexa gesprochenen Befehle und
 * stellt diese in einem Datenpunkt in einem JSON zur Verfügung zur Anzeige in einer VIS-Tabelle.
* ------------------------------------------------------------------------------- 
 * Aktuelle Version: https://github.com/Mic-M/iobroker.alexa-history-vis-script/
 * Support:          (Link folgt)
 * Autor:            Mic (ioBroker) | Mic-M (github)
 * ------------------------------------------------------------------------------- 
 * Voraussetzungen / Empfehlungen:
 *  - Voraussetzung: Alexa-Adapter: https://github.com/Apollon77/ioBroker.alexa2
 *  - Empfehlung: Material Design Widgets: https://github.com/Scrounger/ioBroker.vis-materialdesign
 *    (zur Darstellung als Tabelle in VIS, Widget "materialdesign – Table")
  * ------------------------------------------------------------------------------- 
 * Change Log
 *  0.1   * Initial release
 ******************************************************************************************************/

// Datenpunkt-Pfad, der das JSON für die VIS-Tabelle enthalten soll.
// Es wird die Anlage sowohl unterhalb '0_userdata.0' als auch 'javascript.x' unterstützt.
const STATE_PATH = '0_userdata.0.Alexa-History-Script.JSON_Table';

// Hier können einzelne Spalten hinzugefügt, entfernt, oder die Spalten-Reihenfolge verändert werden.
// Mögliche Spalten: ['time, 'name', 'serialNumber', 'summary', 'status', 'domainApplicationId', 'cardContent', 'card'];
// Hinweis: Zusätzlich wird immer eine "timestamp"-Spalte angehängt. Diese brauchen wir für das Script. In VIS
//          dann einfach diese letzte Spalte nicht anzeigen, also weg lassen.
const JSON_TABLE_COLUMS = ['time', 'name', 'summary'];

// Normalerweise wird die "summary", also der Befehl an Alexa, in Kleinbuchstaben zurückgegeben, also z.B. "flurlicht einschalten".
// Wenn diese Option auf "true" ist, wird die Ausgabe zu "Flurlicht Einschalten", also jeweils erster
// Buchstabe groß. Falls nicht gewünscht, auf "false" setzen.
const CAPITALIZE_FIRSTS = true;

// Maximale Anzahl an Tabellenzeilen. Nicht übertreiben, bitte.
const MAX_ENTRIES = 50;

// Datum/Uhrzeit formatieren.
// Angaben innerhalb von "#" werden durch Heute/Gestern ersetzt falls zutreffend. 
// "#"-Zeichen entfernen, falls nicht gewünscht.
const TABLE_DATE_FORMAT = '#DD.MM.YY# um hh:mm:ss Uhr';

// Pfad zum Alexa-Adapter, History-Datenpunkt. Kann man immer so lassen, 
// es sei denn eine andere Alexa-Adapter-Instanz wird verwendet.
const HISTORY_STATE = 'alexa2.0.History.json';


/*************************************************************************************************************************
 * Ab hier nichts mehr ändern / Stop editing here!
 *************************************************************************************************************************/

/****************************************************************************************
 * Global variables and constants
 ****************************************************************************************/
// Final state path
const FINAL_STATE_PATH = validateStatePath(STATE_PATH, true);
const FINAL_STATE_LOCATION = validateStatePath(STATE_PATH, false);

// Global variables
let G_tableObjects = [];
let G_ScheduleMidnightJsonUpdate;

/****************************************************************************************
 * Initialize
 ****************************************************************************************/
init();
function init() {

    // Create states.
    createUserStates(FINAL_STATE_LOCATION, false, [FINAL_STATE_PATH, {'name':'Alexa History: JSON for VIS table', 'type':'string', 'read':true, 'write':false, 'role':'value', 'def':'' }], function() {

        setTimeout(function() {

            // Get current JSON Table states into G_tableObjects.
            // We do this to get all history if script is re-started and there were entries already.
            let currTableStateContent = getState(FINAL_STATE_PATH).val;
            if (! isLikeEmpty(currTableStateContent)) {
                G_tableObjects = JSON.parse(currTableStateContent);
            }

            // Subscribe to Alexa History state
            subscribeHistory();

            // Initially update the JSON table dates. After a delay, just in case.
            setTimeout(updateJsonTableDates, 2000);

            // Schedule midnight JSON update (due to "Heute"/"Gestern" in date)
            if (TABLE_DATE_FORMAT.indexOf('#') > -1) { // Do not schedule if we don't have #
                clearSchedule(G_ScheduleMidnightJsonUpdate);
                G_ScheduleMidnightJsonUpdate = schedule('1 0 * * *', function() { // Um 00:01 jeden Tag
                    updateJsonTableDates();
                }); 
            }

        }, 2000);


    })
}

/**
 * Subscribe to the Alexa History state
 */
function subscribeHistory() {

    on({id: HISTORY_STATE, change:'any'}, function(obj) {

        // obj.state.val: JSON string of oject.
        // Like: {"name":"Alexa Flur","serialNumber":"xxxxxxxxxx","summary":"Wohnlicht an","creationTime":1582843794820, ... }
        let objHistory = JSON.parse(obj.state.val); 
        let summary   = objHistory['summary'];

        // ignore alexa keywords or empty value.
        if(! (['', 'alexa','echo','computer'].includes(summary) )) {
            // ignore "sprich mir nach"
            if (!(summary.includes('sprich mir nach '))) {

                // Generate JSON table row object
                let jsonTableRowObject = convertAlexaJson(objHistory);

                // Limit array lengths per MAX_ENTRIES
                G_tableObjects = G_tableObjects.slice(0, MAX_ENTRIES-1);

                // Add new log as first element to arrays.
                G_tableObjects.unshift(jsonTableRowObject); // Add item to beginning of array  

                // Update our state. Since we have kept states history in variables, we just update with new variable contents
                setState(FINAL_STATE_PATH, JSON.stringify(G_tableObjects));

            }
        }
    });

}

/**
 * Update Json Table dates to apply new "Today"/"Yesterday" ad midnight
 */
function updateJsonTableDates() {

    if (!isLikeEmpty(G_tableObjects)) {

        // First, update time in variable by using the timestamp which we have.
        for (let i = 0; i < G_tableObjects.length; i++) {
            G_tableObjects[i]['time'] = dateToString(G_tableObjects[i]['timestamp'], TABLE_DATE_FORMAT);
        }

        // Second, update state        
	    setState(FINAL_STATE_PATH, JSON.stringify(G_tableObjects));

    }

}

/**
 * Converts HISTORY_STATE JSON object from Alexa Adapter to VIS table row
 * @param  {object}  alexaHistoryObject    Object from HISTORY_STATE JSON
 * @return {object}                        Result object for VIS table row
 */
function convertAlexaJson(alexaHistoryObject) {
    
    // Let's build the JSON Table row object.
    // We use JSON_TABLE_COLUMS setting for columns and also for their order, and we always add timestamp as last column,
    // as we need it to calculate "Today"/"Heute".
    let objectJSONentry = {};
    for (let lpCol of JSON_TABLE_COLUMS) {
        // We have a few exceptions which require formatting
        if(lpCol == 'summary') {
            // Capitalize if set. https://stackoverflow.com/questions/2332811/
            objectJSONentry[lpCol] = (CAPITALIZE_FIRSTS) ? alexaHistoryObject['summary'].replace(/\b\w/g, l => l.toUpperCase()) : alexaHistoryObject['summary'];
        } else if (lpCol == 'time') {
            objectJSONentry[lpCol] = dateToString(alexaHistoryObject['creationTime'], TABLE_DATE_FORMAT);
        } else if (lpCol == 'creationTime') {
            // creationTime is the timestamp. We always add it below as last column, so nothing to do here at this point.
        } else {
            objectJSONentry[lpCol] = alexaHistoryObject[lpCol];
        }
    }
    // Always add the timestamp as last column
    objectJSONentry['timestamp'] = alexaHistoryObject['creationTime'];

    // Return final object
    return objectJSONentry;

}




/**
 * ---------------------------------------------------------------------------------------------
 * Converts a given date into a string by replacing "YYYY, MM, DD, hh, mm, ss" in given format.
 * Optional: will replace like DD-MM-YYYY with "Today"/"Yesterday" if within # (hash).
 *           So, '#DD.MM.YY#, hh:mm:ss' will become 'Today, 08:25:13'.
 *           Use optional parameters [todayString] and [yesterdayString] accordingly to replace
 *           with your terms you want to use for "Today" and "Yesterday".
 * ---------------------------------------------------------------------------------------------
 * Version: 1.1
 * Author: Mic
 * Source: https://forum.iobroker.net/topic/24179/
 * ---------------------------------------------------------------------------------------------
 * @param {object|number}  inputDate            The date to convert. Accepts both a date object (like: "new Date()") 
 *                                              or a timestamp number like 1582826332588 (so like what "Date.now()" returns)
 * @param {string}         format               String of which "YYYY, MM, DD, hh, mm, ss" will be replaced accordingls.
 *                                              Examples: 'YYYY-MM-DD hh:mm:ss', 'DD.MM.YY, hh:mm:ss', 'DD.MM.YY um hh:mm:ss Uhr'
 * @param {string}         [todayString]        Optional. String for "Today". Default is "Heute".
 * @param {string}         [yesterdayString]    Optional. String for "Yesterday". Default is "Gestern".
 * @return {string}                             The format containing the date values for YYYY, MM, DD, hh, mm, ss
 */
function dateToString(inputDate, format, todayString='Heute', yesterdayString='Yesterday') {
 
    let strResult = format;
 
    // Convert inputDate to date. This is to accept timestamps, which will be converted to a date object as well
    let dateGiven = new Date(inputDate);
 
 
    // Replace today's date and yesterday's date
    let hashkMatch = strResult.match(/#(.*)#/);
    if (hashkMatch != null) {
        let todayYesterdayTxt = todayYesterday(dateGiven);
        if(todayYesterdayTxt != '') {
            // We have either today or yesterday, so set according txt
            strResult = strResult.replace('#'+hashkMatch[1]+'#', todayYesterdayTxt);
        } else {
            // Neither today nor yesterday, so remove all ##
            strResult = strResult.replace(/#/g, '');
        }        
    }
 
    // Replace YYYY, YY, MM, DD, hh, mm, ss accordingly with actual date/times
    strResult = strResult.replace(/Y{4}/g, zeroPad(dateGiven.getFullYear(), 4));
    strResult = strResult.replace(/Y{2}/g, zeroPad(dateGiven.getFullYear(), 2));
    strResult = strResult.replace(/M{2}/g, zeroPad((dateGiven.getMonth() + 1), 2));
    strResult = strResult.replace(/D{2}/g, zeroPad(dateGiven.getDate(), 2));
    strResult = strResult.replace(/h{2}/g, zeroPad(dateGiven.getHours(), 2));
    strResult = strResult.replace(/m{2}/g, zeroPad(dateGiven.getMinutes(), 2));
    strResult = strResult.replace(/s{2}/g, zeroPad(dateGiven.getSeconds(), 2));
 
    return strResult;
 
 
 
    /**
     * Add leading numbers -  see https://forum.iobroker.net/topic/24179/
     */
    function zeroPad(num, places) {
        let zero = places - num.toString().length + 1;
        return Array(+(zero > 0 && zero)).join('0') + num;        
    } 
 
    /**
     * @param {object} dateGiven   Date object
     * @return                     'Heute', if today, 'Gestern' if yesterday, empty string if neither today nor yesterday
     */
    function todayYesterday(dateGiven) {
        const today = new Date();
        const yesterday = new Date(); 
        yesterday.setDate(today.getDate() - 1)
        if (dateGiven.toLocaleDateString() == today.toLocaleDateString()) {
            return todayString;
        } else if (dateGiven.toLocaleDateString() == yesterday.toLocaleDateString()) {
            return yesterdayString;
        } else {
            return '';
        }
    }
 
}
 
/**
 * Checks if Array or String is not undefined, null or empty.
 * 08-Sep-2019: added check for [ and ] to also catch arrays with empty strings.
 * @param inputVar - Input Array or String, Number, etc.
 * @return true if it is undefined/null/empty, false if it contains value(s)
 * Array or String containing just whitespaces or >'< or >"< or >[< or >]< is considered empty
 */
function isLikeEmpty(inputVar) {
    if (typeof inputVar !== 'undefined' && inputVar !== null) {
        let strTemp = JSON.stringify(inputVar);
        strTemp = strTemp.replace(/\s+/g, ''); // remove all whitespaces
        strTemp = strTemp.replace(/\"+/g, "");  // remove all >"<
        strTemp = strTemp.replace(/\'+/g, "");  // remove all >'<
        strTemp = strTemp.replace(/\[+/g, "");  // remove all >[<
        strTemp = strTemp.replace(/\]+/g, "");  // remove all >]<
        if (strTemp !== '') {
            return false;
        } else {
            return true;
        }
    } else {
        return true;
    }
}

 
/**
 * For a given state path, we extract the location '0_userdata.0' or 'javascript.0' or add '0_userdata.0', if missing.
 * @param {string}  path            Like: 'Computer.Control-PC', 'javascript.0.Computer.Control-PC', '0_userdata.0.Computer.Control-PC'
 * @param {boolean} returnFullPath  If true: full path like '0_userdata.0.Computer.Control-PC', if false: just location like '0_userdata.0' or 'javascript.0'
 * @return {string}                 Path
 */
function validateStatePath(path, returnFullPath) {
    if (path.startsWith('.')) path = path.substr(1);    // Remove first dot
    if (path.endsWith('.'))   path = path.slice(0, -1); // Remove trailing dot
    if (path.length < 1) log('Provided state path is not valid / too short.', 'error')
    let match = path.match(/^((javascript\.([1-9][0-9]|[0-9])\.)|0_userdata\.0\.)/);
    let location = (match == null) ? '0_userdata.0' : match[0].slice(0, -1); // default is '0_userdata.0'.
    if(returnFullPath) {
        return (path.indexOf(location) == 0) ? path : (location + '.' + path);
    } else {
        return location;
    }
}


/**
 * Create states under 0_userdata.0 or javascript.x
 * Current Version:     https://github.com/Mic-M/iobroker.createUserStates
 * Support:             https://forum.iobroker.net/topic/26839/
 * Autor:               Mic (ioBroker) | Mic-M (github)
 * Version:             1.1 (26 January 2020)
 * Example:             see https://github.com/Mic-M/iobroker.createUserStates#beispiel
 * -----------------------------------------------
 * PLEASE NOTE: Per https://github.com/ioBroker/ioBroker.javascript/issues/474, the used function setObject() 
 *              executes the callback PRIOR to completing the state creation. Therefore, we use a setTimeout and counter. 
 * -----------------------------------------------
 * @param {string} where          Where to create the state: '0_userdata.0' or 'javascript.x'.
 * @param {boolean} force         Force state creation (overwrite), if state is existing.
 * @param {array} statesToCreate  State(s) to create. single array or array of arrays
 * @param {object} [callback]     Optional: a callback function -- This provided function will be executed after all states are created.
 */
function createUserStates(where, force, statesToCreate, callback = undefined) {
 
    const WARN = false; // Only for 0_userdata.0: Throws warning in log, if state is already existing and force=false. Default is false, so no warning in log, if state exists.
    const LOG_DEBUG = false; // To debug this function, set to true
    // Per issue #474 (https://github.com/ioBroker/ioBroker.javascript/issues/474), the used function setObject() executes the callback 
    // before the state is actual created. Therefore, we use a setTimeout and counter as a workaround.
    const DELAY = 50; // Delay in milliseconds (ms). Increase this to 100, if it is not working.

    // Validate "where"
    if (where.endsWith('.')) where = where.slice(0, -1); // Remove trailing dot
    if ( (where.match(/^((javascript\.([1-9][0-9]|[0-9]))$|0_userdata\.0$)/) == null) ) {
        log('This script does not support to create states under [' + where + ']', 'error');
        return;
    }

    // Prepare "statesToCreate" since we also allow a single state to create
    if(!Array.isArray(statesToCreate[0])) statesToCreate = [statesToCreate]; // wrap into array, if just one array and not inside an array

    // Add "where" to STATES_TO_CREATE
    for (let i = 0; i < statesToCreate.length; i++) {
        let lpPath = statesToCreate[i][0].replace(/\.*\./g, '.'); // replace all multiple dots like '..', '...' with a single '.'
        lpPath = lpPath.replace(/^((javascript\.([1-9][0-9]|[0-9])\.)|0_userdata\.0\.)/,'') // remove any javascript.x. / 0_userdata.0. from beginning
        lpPath = where + '.' + lpPath; // add where to beginning of string
        statesToCreate[i][0] = lpPath;
    }

    if (where != '0_userdata.0') {
        // Create States under javascript.x
        let numStates = statesToCreate.length;
        statesToCreate.forEach(function(loopParam) {
            if (LOG_DEBUG) log('[Debug] Now we are creating new state [' + loopParam[0] + ']');
            let loopInit = (loopParam[1]['def'] == undefined) ? null : loopParam[1]['def']; // mimic same behavior as createState if no init value is provided
            createState(loopParam[0], loopInit, force, loopParam[1], function() {
                numStates--;
                if (numStates === 0) {
                    if (LOG_DEBUG) log('[Debug] All states processed.');
                    if (typeof callback === 'function') { // execute if a function was provided to parameter callback
                        if (LOG_DEBUG) log('[Debug] Function to callback parameter was provided');
                        return callback();
                    } else {
                        return;
                    }
                }
            });
        });
    } else {
        // Create States under 0_userdata.0
        let numStates = statesToCreate.length;
        let counter = -1;
        statesToCreate.forEach(function(loopParam) {
            counter += 1;
            if (LOG_DEBUG) log ('[Debug] Currently processing following state: [' + loopParam[0] + ']');
            if( ($(loopParam[0]).length > 0) && (existsState(loopParam[0])) ) { // Workaround due to https://github.com/ioBroker/ioBroker.javascript/issues/478
                // State is existing.
                if (WARN && !force) log('State [' + loopParam[0] + '] is already existing and will no longer be created.', 'warn');
                if (!WARN && LOG_DEBUG) log('[Debug] State [' + loopParam[0] + '] is already existing. Option force (=overwrite) is set to [' + force + '].');
                if(!force) {
                    // State exists and shall not be overwritten since force=false
                    // So, we do not proceed.
                    numStates--;
                    if (numStates === 0) {
                        if (LOG_DEBUG) log('[Debug] All states successfully processed!');
                        if (typeof callback === 'function') { // execute if a function was provided to parameter callback
                            if (LOG_DEBUG) log('[Debug] An optional callback function was provided, which we are going to execute now.');
                            return callback();
                        }
                    } else {
                        // We need to go out and continue with next element in loop.
                        return; // https://stackoverflow.com/questions/18452920/continue-in-cursor-foreach
                    }
                } // if(!force)
            }

            // State is not existing or force = true, so we are continuing to create the state through setObject().
            let obj = {};
            obj.type = 'state';
            obj.native = {};
            obj.common = loopParam[1];
            setObject(loopParam[0], obj, function (err) {
                if (err) {
                    log('Cannot write object for state [' + loopParam[0] + ']: ' + err);
                } else {
                    if (LOG_DEBUG) log('[Debug] Now we are creating new state [' + loopParam[0] + ']')
                    let init = null;
                    if(loopParam[1].def === undefined) {
                        if(loopParam[1].type === 'number') init = 0;
                        if(loopParam[1].type === 'boolean') init = false;
                        if(loopParam[1].type === 'string') init = '';
                    } else {
                        init = loopParam[1].def;
                    }
                    setTimeout(function() {
                        setState(loopParam[0], init, true, function() {
                            if (LOG_DEBUG) log('[Debug] setState durchgeführt: ' + loopParam[0]);
                            numStates--;
                            if (numStates === 0) {
                                if (LOG_DEBUG) log('[Debug] All states processed.');
                                if (typeof callback === 'function') { // execute if a function was provided to parameter callback
                                    if (LOG_DEBUG) log('[Debug] Function to callback parameter was provided');
                                    return callback();
                                }
                            }
                        });
                    }, DELAY + (20 * counter) );
                }
            });
        });
    }
}





