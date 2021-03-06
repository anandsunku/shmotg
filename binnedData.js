// This is binnedData. A convenient way of storing binned data

binnedData = function () {
    "use strict";

    //{{{ VARIABLES
    var oneSample = 1000 / 200; // milliseconds per sample

    var bd = { // where all of the data is stored
        keys : ['average', 'maxes', 'mins', 'q1', 'q3'],
        rawData : {
            levels: [], // stores all of the values for each level in an array of objects (shmotg.MAX_NUMBER_OF_ITEMS_PER_ARRAY).
                        // with one key for each range of object, up to a maximum size
                        // example: [{ ms_key: [{val: 1.7, ms: ms_since_epoch}, {val: 2.3, ms: ms_since_epoch}] }, [etc.]]
                        //           ^-- a "bin container" -----------------------------------------------------^
        },
        average : {
            func   : function (a, b) { return (a+b)/2; },
            levels: [],
        },
        maxes : {
            func   : function (a, b) { return d3.max([a,b]); },
            levels: [],
        },
        mins : {
            func   : function (a, b) { return d3.min([a,b]); },
            levels: [],
        },
        q1 : {
            func   : function (a, b, c, d) { return average(getTwoSmallest([a, b, c, d])); },
            levels: [],
        },
        q3 : {
            func   : function (a, b, c, d) { return average(getTwoLargest([a, b, c, d])); },
            levels: [],
        },
        quartiles : {
            levels: [],
        },
        missing : {
            levels: [],
        },
        missingBox : {
            levels: [],
        },
        loadingBox : {
            levels: [],
        },
    };

    // VARIABLES }}}

    //{{{ HELPER METHODS

    function sampleSize(lvl) {
        return Math.pow(2, lvl) * oneSample;
    }

    function combineWithoutDuplicates(arr1, arr2) {
        // ASSUMPTION: arr1 and arr2 are both sorted
        //             arr1 and arr2 are in the format: [{ms: _}, {ms: _}]
        // TODO: arr1 gets precedence. Return an array which has no duplicates in the 'ms' field.

        var uniques = []; // The values found in arr2 which were not in arr1
        var arr1Length = arr1.length;
        var arr1Index = 0;

        for (var i = 0; i < arr2.length; i++) {
            // For each element of arr2, go through arr1,
            // element by element, and see how their ms compare

            while (1) {
                if (arr1Index >= arr1Length) {
                    // we've run out of arr1

                    uniques.push(arr2[i]);
                    break;
                }

                if (arr1[arr1Index].ms > arr2[i].ms) {
                    // If the next one is higher,
                    // add this one to the list,
                    // and move on to the next arr2 (don't increment)

                    uniques.push(arr2[i]);

                    break;
                } else if (arr1[arr1Index].ms === arr2[i].ms) {
                    // If the next one is the same,
                    // move on to the next arr2 (don't increment)

                    // Though, if one is NaN, then the other should be used.
                    if (isNaN(arr1[arr1Index].val)) {
                        arr1[arr1Index].val = arr2[i].val;
                    }

                    break;
                } else {
                    // If the next one is lower than this one,
                    // increment and compare to the new one from arr1

                    arr1Index++;
                }
            }
        }

        return arr1.concat(uniques);
    }

    function startOfContainerAtLevel (ms, lvl) {
        // TODO: calculate the starting ms of the bin container
        // [at this level] in which this ms would fit.


        var sizeOfTheBinContainerInMS = sampleSize(lvl) * shmotg.MAX_NUMBER_OF_ITEMS_PER_ARRAY;

        return Math.floor(ms / ( sizeOfTheBinContainerInMS )) * sizeOfTheBinContainerInMS;
    }

    function isArray(a) {
        return Object.prototype.toString.call(a) === '[object Array]';
    }

    function getSurroundingBins (start, end, lvl) {
        // return all bin starts at this level between start and end
        // NOT INCLUDING the highest point if it is equal to end

        var binSize = Math.pow(2, lvl) * oneSample;

        var startRounded = startOfContainerAtLevel(start, lvl);

        return _.range(startRounded, end, binSize);
    }

    function getSurroundingBinContainers (start, end, lvl) {
        // return all bin container starts at this level between start and end
        // NOT INCLUDING the highest point if it is equal to end

        var binSize = my.binContainerSize(lvl);

        var startRounded = startOfContainerAtLevel(start, lvl);

        return _.range(startRounded, end, binSize);
    }

    function splitIntoBinsAtLevel (data, lvl) {
        // TODO: round level down to nearest maxNumberOfBins
        //       then separate the data out into a structure:
        //       { '0': [{ms: 3}, {ms: 4}]
        //         '5': [{ms: 5}, {ms: 9}]}
        //       This function is to be used when adding raw data
        // Assumption: data is ordered and continuous

        return _.groupBy(data, function (d) {
            return startOfContainerAtLevel(d.ms, lvl);
        });
    }

    function rebin (range_to_rebin, level_to_rebin) {
        // for each level other than raw data level,
        //   for each key,
        //     bin the data from the lower level
        for (var j = level_to_rebin + 1; j < shmotg.MAX_NUMBER_OF_BIN_LEVELS; j++){ // for each bin level
            for (var keyValue = 0; keyValue < bd.keys.length; keyValue++) { // for each of 'average', 'max', 'min', etc.
                var key = bd.keys[keyValue];

                // bin and store data from lower bin
                var newData = binTheDataWithFunction(bd, j-1, key, bd[key].func, range_to_rebin);

                if (newData.length === 0) {
                    continue;
                }

                // TODO: filter out what is already in the old data, OR add that ability to addData();
                // Combine what was already there and what was just calculated
                // - What was already in this bin level gets precedence
                //   over what is being binned from the lower level

                my.addData(newData, key, j);

            } // for each key
        } // for each bin level
    }

    function combineFilteredBinContainerInformation (bin, lvl, key, range) {
        // Returns ALL data from any container which intersects the requested range
        // AKA:  Grabs ALL containers which line up with the containers of the
        //       one-higher level's intersection with this range

        // get lvl+1's range of containers for this range
        var upperLevelRange = [ // range until very end
            startOfContainerAtLevel(range[0], lvl+1),
            startOfContainerAtLevel(range[1], lvl+1) + my.binContainerSize(lvl+1)
        ];

        if (!upperLevelRange[0] || !upperLevelRange[1]) {
            return [];
        }
        var binsToBeCombined = getSurroundingBinContainers(upperLevelRange[0], upperLevelRange[1], lvl);

        var combo = [];
        for (var i in binsToBeCombined) {
            if (bin[lvl === 0 ? "rawData" : key].levels[lvl][binsToBeCombined[i]]){
                combo = combo.concat(bin[lvl === 0 ? "rawData" : key].levels[lvl][binsToBeCombined[i]]);
            }
        }

        return combo;
    }

    function binTheDataWithFunction (bin, curLevel, key, func, range_to_rebin) {
        // Bin the data in a level into abstracted bins

        var bDat = [];
        if (!bin[curLevel === 0 ? "rawData" : key].levels[curLevel]) {
            return bDat;
        }

        // Combine all data which is within range_to_rebin
        var combo = combineFilteredBinContainerInformation(bin, curLevel, key, range_to_rebin);
        var combo2 = [];

        // if we're calculating for quartiles, then we need the other quartile as well
        if (key === 'q1') {
            combo2 = combineFilteredBinContainerInformation(bin, curLevel, 'q3', range_to_rebin);
        } else if (key === 'q3'){
            combo2 = combineFilteredBinContainerInformation(bin, curLevel, 'q1', range_to_rebin);
        }

        for(var i = 0; i < combo.length; i = i + 2){
            // If we are at a bad spot to begin a bin, decrement i by 1 and continue;
            var sampleIsAtModularLocation = atModularLocation(combo[i].ms, curLevel+1);
            var nextSampleExists = combo.length > i + 1;
            var nextSampleIsRightDistanceAway = nextSampleExists ?
                combo[i+1].ms - combo[i].ms === sampleSize(curLevel) :
                true;

            if (!sampleIsAtModularLocation || !nextSampleExists || !nextSampleIsRightDistanceAway) {
                // This is here so that both the server and client's bins start and end at the same place
                // no matter what range of data they have to work with.
                // we skip over values which are not at the beginning of a bin
                i = i - 1;
                continue;
            }

            if (combo[i+1]){
                var newdate = combo[i/*+1*/].ms;

                if (key === 'q1' || key === 'q3') {
                    if (combo[i] === undefined ||
                        combo[i+1] === undefined ||
                        combo2[i] === undefined ||
                        combo2[i+1] === undefined) {
                        // do nothing
                    } else {
                        bDat.push({ val:  func(
                                            combo[i].val,
                                            combo[i+1].val,
                                            combo2[i].val,
                                            combo2[i+1].val),
                                    ms: newdate });
                    }
                }else{
                    bDat.push( { val: func( combo[i].val,
                                            combo[i+1].val),
                                 ms: newdate });
                }
            }
        }
        return bDat;
    }

    function atModularLocation(ms, lvl) {
        // Return true if ms is at the beginning of a bin in level lvl.

        return ms % (Math.pow(2, lvl) * oneSample) === 0;
    }

    function getTwoLargest (array) {
        var arr = array.slice();
        var first = d3.max(arr);
        arr.splice(arr.indexOf(first),1);
        var second = d3.max(arr);
        return [first, second];
    }

    function average (array) {
        return d3.sum(array)/array.length;
    }

    function getTwoSmallest (array) {
        var arr = array.slice();
        var first = d3.min(arr);
        arr.splice(arr.indexOf(first),1);
        var second = d3.min(arr);
        return [first, second];
    }

    function combineAndSortArraysOfDateValObjects (arr1, arr2) {
        // Add the objects from arr2 (array) to arr1 (array)
        //   only if the object from arr2 has a ms value
        //   which no object in arr1 has.
        // AKA: arr1 gets precedence

        // concat them
        var result = combineWithoutDuplicates(arr1, arr2);

        result.sort(function (a, b) { return a.ms - b.ms; });

        return result;
    }

    function inAButNotInB(arr1, arr2) {
        return _.filter(arr1, function (d) {
            return !_.contains(arr2, d);
        });
    }

    // HELPER METHODS }}}

    //{{{ MY (runs whenever something changes)

    var my = function () {
    };

    // MY }}}

    //{{{ PUBLIC METHODS

    my.addData = function (data, key, lvl) {
        // data must be in the following form: (example)
        // [ {val: value_point, ms: ms_since_epoch},
        //   {val: value_point, ms: ms_since_epoch},
        //   {etc...},
        // ],

        var splitData = splitIntoBinsAtLevel(data, lvl);

        for (var prop in splitData) {
            if (splitData.hasOwnProperty(prop)){
                if (!bd[key].levels[lvl]) { bd[key].levels[lvl] = {}; }
                if (!bd[key].levels[lvl][prop]) { bd[key].levels[lvl][prop] = []; }

                bd[key].levels[lvl][prop] = combineAndSortArraysOfDateValObjects(bd[key].levels[lvl][prop], splitData[prop]);
            }
        }
    };

    my.addRawData = function (data, dontBin) {
        // data must be in the following form: (example)
        // [ {val: value_point, ms: ms_since_epoch},
        //   {val: value_point, ms: ms_since_epoch},
        //   {etc...},
        // ],

        var range = d3.extent(data, function (d) { return d.ms; });

        my.addData(data, 'rawData', 0);

        if(!dontBin) {
            rebin(range, 0);
        }

        return my;

    };

    my.replaceRawData = function (data, dontBin) {
        // data must be in the following form: (example)
        // [ {val: value_point, ms: ms_since_epoch},
        //   {val: value_point, ms: ms_since_epoch},
        //   {etc...},
        // ],

        var range = d3.extent(data, function (d) { return d.ms; });

        if (!bd.rawData.levels[0]) { bd.rawData.levels[0] = []; }

        bd.rawData.levels[0] = data;

        if(!dontBin) {
            rebin(range, 0);
        }

        return my;
    };

    my.addBinnedData = function (bData, lvl, dontBin) {
        // only the level lvl will be stored
        // data must be in the form of the following example:
        // { average: {
        //     levels: [
        //       [{val: value_point, ms: ms_since_epoch},
        //        {val: value_point, ms: ms_since_epoch},
        //        {etc...}],
        //       [etc.]
        //     ],
        //   },
        //   q1: {
        //     levels: [
        //       [etc.]
        //     ],
        //   },
        //   etc: {},
        // }

        var lows = [];
        var highs = [];
        var keys = ['average', 'q1', 'q3', 'mins', 'maxes'];

        var justms = function(d) { return d.ms; };

        for (var i = 0; i < keys.length; i++) {
            if (bData[keys[i]] && bData[keys[i]].levels && bData[keys[i]].levels[lvl]) {
                var ext = d3.extent(bData[keys[i]].levels[lvl], justms);
                lows.push(ext[0]);
                highs.push(ext[1]);
            }
        }

        var range = [
                d3.min(lows),
                d3.max(highs)
        ];

        for (var k = 0; k < bd.keys.length; k++) { // for each of max_val, min_val, etc.
            var key = bd.keys[k];
            my.addData(bData[key].levels[lvl], key, lvl);
        }

        if(!dontBin) {
            rebin(range, lvl);
        }

        return my;
    };

    my.replaceBinnedData = function(bData, lvl, dontBin) {
        // only the level lvl will be stored
        // data must be in the form of the following example:
        // { average: {
        //     levels: [
        //       [{val: value_point, ms: ms_since_epoch},
        //        {val: value_point, ms: ms_since_epoch},
        //        {etc...}],
        //       [etc.]
        //     ],
        //   },
        //   q1: {
        //     levels: [
        //       [etc.]
        //     ],
        //   },
        //   etc: {},
        // }

        var range = d3.extent(bData.average.levels[lvl], function (d) { return d.ms; });

        for (var k = 0; k < bd.keys.length; k++) { // for each of max_val, min_val, etc.
            var key = bd.keys[k];

            if (!bd[key].levels[lvl]) { bd[key].levels[lvl] = []; }

            if(bData[key].levels) {
                bd[key].levels[lvl] = bData[key].levels[lvl];
            }
        } // for each of max_val, min_val, etc.

        if(!dontBin) {
            rebin(range, 0);
        }

        return my;
    };

    my.replaceAllData = function (bDat) {
        bd = bDat;
    };


    my.haveDataInRange = function(ms_range, level) {
        // Determine the number of samples which we should have in the given range.

        var key;
        if (level === 0) {
            key = "rawData";
        } else {
            key = "average";
        }

        var datedRange = my.getDateRange([key], level, ms_range);

        if (datedRange.length === 0) {
            return false;
        }

        var firstSample = datedRange[0].ms;

        if (firstSample > ms_range[0] + sampleSize(level)) {
            return false;
        }

        var actualRange = ms_range[1] - firstSample;
        var numberWeShouldHave = Math.floor(actualRange / sampleSize(level));

        var numberWeHave = datedRange.length;

        return numberWeHave >= numberWeShouldHave;
    };

    my.missingBins = function(ms_range, level, samplesInsteadOfRanges) {
        // Return which bins which we are missing in the given range and level.
        // returns [[start, end],[start,end],...] ranges of required data

        var key;
        if (level === 0) {
            key = "rawData";
        } else {
            key = "average";
        }

        var fir = Math.floor(ms_range[0] / (Math.pow(2, level) * oneSample));
        var las = Math.floor(ms_range[1] / (Math.pow(2, level) * oneSample));

        var normalizedRange = [ fir * Math.pow(2, level) * oneSample, (las + 1) * Math.pow(2, level) * oneSample ];
        var datedRange = my.getDateRange([key], level, normalizedRange);

        if (datedRange.length === 0) {
            if (samplesInsteadOfRanges) { return [ms_range[0]]; }
            return [ms_range];
        }

        var neededBins = _.range(normalizedRange[0], normalizedRange[1], sampleSize(level));
        neededBins.forEach(function (d) {
            d = d * Math.pow(2, level) * oneSample;
        });

        var missingSamples = inAButNotInB(neededBins, _.pluck(datedRange, 'ms'));
        missingSamples.total = datedRange.length;

        if(samplesInsteadOfRanges) { return missingSamples; }

        var missingRanges = [];

        _.each(missingSamples, function (d) {
            missingRanges.push([d, d + sampleSize(level)]);
            // missingRanges will now be like this: [[0,1],[1,2],[4,5],[5,6],[6,7]]
        });

        return missingRanges; // form: [[0,1],[1,2],[4,5],[5,6],[6,7]]
    };

    my.getExtentsForLvlKeysRange = function (lvl, keys, range) {
        return d3.extent(my.getDateRange(keys, lvl, range), function (d) { return d.val; });
    };

    my.getMin = function (lvl) {
        var lowestValue = 999999;
        var k = "";
        var justval = function (d) { return d.val; };

        if (lvl === 0) {
            k = "rawData";
        } else {
            k = "average";
        }

        for (var key = 0; key < bd[k].levels[lvl].length; key++) {
            lowestValue = Math.min(d3.min(bd[k].levels[lvl][key], justval),
                                    lowestValue);
        }

        return lowestValue;
    };

    my.getMax = function (lvl) {
        var highestValue = -999999;
        var k = "";
        var justval = function (d) { return d.val; };

        if (lvl === 0) {
            k = "rawData";
        } else {
            k = "average";
        }

        for (var key = 0; key < bd[k].levels[lvl].length; key++) {
            highestValue = Math.max(d3.max(bd[k].levels[lvl][key], justval),
                                    highestValue);
        }

        return highestValue;
    };

    my.getMinMS = function (lvl) {
        // pick the minimum bin (highest key) in bd level lvl
        // and ask for the lowest raw value

        var justms = function (d) { return d.ms; };
        var k = "";

        if (lvl === 0) {
            k = "rawData";
        } else {
            k = "average";
        }

        var getMinOfArray = function (numArray) {
            return Math.min.apply(null, numArray);
        };

        var keys = Object.keys(bd[k].levels[lvl]);
        return d3.min(bd[k].levels[lvl][getMinOfArray(keys)], justms);
    };

    my.getMaxMS = function (lvl) {
        var justms = function (d) { return d.ms; };
        var k = "";

        if (lvl === 0) {
            k = "rawData";
        } else {
            k = "average";
        }

        var getMaxOfArray = function (numArray) {
            return Math.max.apply(null, numArray);
        };

        var keys = Object.keys(bd[k].levels[lvl]);
        return d3.max(bd[k].levels[lvl][getMaxOfArray(keys)], justms);
    };

    my.getColor = function (key) {
        return bd[key].color;
    };

    my.getDash = function (key) {
        return bd[key].dash;
    };

    my.getOpacity = function (key) {
        return bd[key].opacity;
    };

    my.getAllInRange = function(lvl, range) {
        // return a bd-like data structure but only
        // with data in the following range and level
        // from all keys

        // initialize the data structure to be sent
        var theKeys = ["average", "q1", "q3", "mins", "maxes"];
        var send_req = {};

        for (var i = 0; i < theKeys.length; i++) {
            send_req[theKeys[i]] = {};
            send_req[theKeys[i]].levels = [];
            send_req[theKeys[i]].levels[lvl] = my.getDateRange([theKeys[i]], lvl, range);
        }

        return send_req;
    };

    my.getDateRangeWithMissingValues = function (key, lvl, range, extra) {
        // give the range of data for this key and level
        // NOT including the highest value in range
        // USE:
        // filter an array so that we don't render much more
        // than the required amount of line and area
        // missing values are NaN's

        // Send one extra value on the front and end of the range, no matter what

        var missings = my.missingBins(range, lvl, true);
        var binSize = my.binSize(lvl);

        var missingsObjs = missings.map(function (d) {
            return {ms: d, val: NaN};
        });

        var result = combineAndSortArraysOfDateValObjects(
                missingsObjs,
                my.getDateRange([key], lvl, [range[0]-binSize, range[1]+binSize])
                );

        // if we should add in an extra value before each NaN
        // so that everything looks nice for step-after interpolation
        if (extra) {
            var toEnd = result.length;
            for (var i = 1; i < toEnd; i++) {
                if (isNaN(result[i].val)) {
                    result.splice(i, 0, { ms: result[i].ms, val: result[i-1].val });
                    i++;
                    toEnd++;
                }
            }
        }

        return result;
    };

    my.getDateRange = function (keys, lvl, range) {
        // give the range of data for this key and level
        // NOT including the highest value in range
        // USE CASE:
        // filter an array so that we don't render much more
        // than the required amount of line and area

        var result = [];
        var combineAll = function(n) {
            if(!bd[lvl === 0 ? "rawData" : key] || !bd[lvl === 0 ? "rawData" : key].levels[lvl]) { return; }
            var dat = bd[lvl === 0 ? "rawData" : key].levels[lvl][n];

            result = result.concat(_.filter(dat, function (d) {
                return d.ms <= range[1] && d.ms >= range[0];
            }));
        };

        var whichBinsToLookIn = getSurroundingBinContainers(range[0], range[1], lvl);

        for (var k = 0; k < keys.length; k++) {
            var key = keys[k];
            _.each(whichBinsToLookIn, combineAll);
        }

        result = result.sort(function (a, b) { return a.ms - b.ms; });

        return result;
    };

    my.removeAllLevelsBelow = function(LowestLevel) {
        for(var i = 0; i < LowestLevel; i++) {
            for(var k = 0; k < bd.keys.length; k++) {
                var key = bd.keys[k];
                bd[key].levels[i] = {};
            }
        }

        if (LowestLevel > 0) {
            bd.rawData.levels[0] = {};
        }
    };

    my.importDataFromAnotherBinnedDataObject = function (otherBinnedData) {
        for (var k = 0; k < otherBinnedData.keys.length; k++) {
            var key = otherBinnedData.keys[k];

            for (var l = 0; l < shmotg.MAX_NUMBER_OF_BIN_LEVELS; l++) {
                // for each level

                if (!otherBinnedData[key].levels[l]) { continue; }

                for (var b = 0; b < otherBinnedData[key].levels[l].length; b++) {
                    // for each bin container

                    if (!bd[key].levels[l]) {
                        bd[key].levels[l] = {};
                    }

                    if (!bd[key].levels[l].hasOwnProperty(b)) {
                       bd[key].levels[l][b] = otherBinnedData[key].levels[l][b];
                    } else {
                       bd[key].levels[l][b] = combineWithoutDuplicates(
                           bd[key].levels[l][b],
                           otherBinnedData[key].levels[l][b]);
                    }
                }
            }
        }
    };

    my.doToEachContainerInRange = function (range, level, func) {
        getSurroundingBinContainers(range[0], range[1], level).forEach(function (d) {
            func(d);
        });
    };

    my.binSize = function (lvl) {
        return Math.pow(2, lvl) * oneSample;
    };

    my.oneSample = function (value) {
        if (!arguments.length) return oneSample;
        oneSample = value;
        return my;
    };

    my.binContainerSize = function (lvl) {
        return my.binSize(lvl) * shmotg.MAX_NUMBER_OF_ITEMS_PER_ARRAY;
    };

    my.getSurroundingBinContainers = function (r0, r1, lvl) {
        return getSurroundingBinContainers(r0, r1, lvl);
    };

    my.getSurroundingBins = function (start, end, lvl) {
        return getSurroundingBins(start, end, lvl);
    };

    my.getBinContainerForMSAtLevel = function (ms, lvl) {
        return startOfContainerAtLevel(ms, lvl);
    };

    my.getKeys = function () {
        // Return a copy of the array of keys
        return bd.keys.slice(0);
    };

    my.bd = function () {
        return bd;
    };

    my.combineAndSortArraysOfDateValObjects = function(a, b) {
        return combineAndSortArraysOfDateValObjects(a, b);
    };

    my.getChildBins = function(ms, lvl) {
        // Return an array of two bins of level lvl-1,
        // which are the bins which are used to calculate
        // the value for the bin at ms.

        var result = [ms];
        var siz = my.binSize(lvl-1);
        if (atModularLocation(ms, lvl)) {
            result.push(ms+siz);
        } else {
            result.push(ms-siz);
        }
        return result;
    };

    my.toString = function () {
        // Return bd as a string
        return JSON.stringify(bd);
    };

    my.rebinAll = function (range, lvl) {
        rebin(range, lvl);
    };

    // PUBLIC METHODS }}}

    return my;
};

/* vim: set foldmethod=marker: */
