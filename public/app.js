(function(/*! Brunch !*/) {
  'use strict';

  var globals = typeof window !== 'undefined' ? window : global;
  if (typeof globals.require === 'function') return;

  var modules = {};
  var cache = {};

  var has = function(object, name) {
    return ({}).hasOwnProperty.call(object, name);
  };

  var expand = function(root, name) {
    var results = [], parts, part;
    if (/^\.\.?(\/|$)/.test(name)) {
      parts = [root, name].join('/').split('/');
    } else {
      parts = name.split('/');
    }
    for (var i = 0, length = parts.length; i < length; i++) {
      part = parts[i];
      if (part === '..') {
        results.pop();
      } else if (part !== '.' && part !== '') {
        results.push(part);
      }
    }
    return results.join('/');
  };

  var dirname = function(path) {
    return path.split('/').slice(0, -1).join('/');
  };

  var localRequire = function(path) {
    return function(name) {
      var dir = dirname(path);
      var absolute = expand(dir, name);
      return globals.require(absolute, path);
    };
  };

  var initModule = function(name, definition) {
    var module = {id: name, exports: {}};
    cache[name] = module;
    definition(module.exports, localRequire(name), module);
    return module.exports;
  };

  var require = function(name, loaderPath) {
    var path = expand(name, '.');
    if (loaderPath == null) loaderPath = '/';

    if (has(cache, path)) return cache[path].exports;
    if (has(modules, path)) return initModule(path, modules[path]);

    var dirIndex = expand(path, './index');
    if (has(cache, dirIndex)) return cache[dirIndex].exports;
    if (has(modules, dirIndex)) return initModule(dirIndex, modules[dirIndex]);

    throw new Error('Cannot find module "' + name + '" from '+ '"' + loaderPath + '"');
  };

  var define = function(bundle, fn) {
    if (typeof bundle === 'object') {
      for (var key in bundle) {
        if (has(bundle, key)) {
          modules[key] = bundle[key];
        }
      }
    } else {
      modules[bundle] = fn;
    }
  };

  var list = function() {
    var result = [];
    for (var item in modules) {
      if (has(modules, item)) {
        result.push(item);
      }
    }
    return result;
  };

  globals.require = require;
  globals.require.define = define;
  globals.require.register = define;
  globals.require.list = list;
  globals.require.brunch = true;
})();
/* xBoard - A Recordable HTML5 Canvas Based Virtual Whiteboard 
 *
 * by Ernie Park, May 2012
 * Under MIT License
 * http://github.com/eipark/xboard
 *
 */

(function() {
/**
 * =============
 *    Helpers
 * =============
 */

/* Calls functions by their name and arguments. Used in canvasFunction
   which is a wrapper around all drawing functions and the interface to XB
   from XBUI. */
function executeFunctionByName(functionName, context /*, args */) {
  var args = Array.prototype.slice.call(arguments, 2);
  var namespaces = functionName.split(".");
  var func = namespaces.pop();
  for (var i = 0; i < namespaces.length; i++) {
      context = context[namespaces[i]];
  }
  return context[func].apply(context, args);
}

/* LZW-compress a string */
function lzw_encode(s) {
    var dict = {};
    var data = (s + "").split("");
    var out = [];
    var currChar;
    var phrase = data[0];
    var code = 256;
    for (var i=1; i<data.length; i++) {
        currChar=data[i];
        if (dict[phrase + currChar] != null) {
            phrase += currChar;
        }
        else {
            out.push(phrase.length > 1 ? dict[phrase] : phrase.charCodeAt(0));
            dict[phrase + currChar] = code;
            code++;
            phrase=currChar;
        }
    }
    out.push(phrase.length > 1 ? dict[phrase] : phrase.charCodeAt(0));
    for (var i=0; i<out.length; i++) {
        out[i] = String.fromCharCode(out[i]);
    }
    return out.join("");
}

/* Decompress an LZW-encoded string */
function lzw_decode(s) {
    var dict = {};
    var data = (s + "").split("");
    var currChar = data[0];
    var oldPhrase = currChar;
    var out = [currChar];
    var code = 256;
    var phrase;
    for (var i=1; i<data.length; i++) {
        var currCode = data[i].charCodeAt(0);
        if (currCode < 256) {
            phrase = data[i];
        }
        else {
           phrase = dict[currCode] ? dict[currCode] : (oldPhrase + currChar);
        }
        out.push(phrase);
        currChar = phrase.charAt(0);
        dict[code] = oldPhrase + currChar;
        code++;
        oldPhrase = phrase;
    }
    return out.join("");
}

/**
 * =============
 *     MODEL
 * =============
 */

/* === BEGIN Event objects === */
/* Begin path event */
function BeginPath(x, y) {
  this.coord = [x, y];
  this.type="b";
  this.time = XB.getRecordingTime();
}

/* End path event */
function ClosePath() {
  this.type = "c";
  this.time = XB.getRecordingTime();
}

/* Point draw event */
function DrawPathToPoint(x, y) {
  this.type = "d";
  this.coord = [x, y];
  this.time = XB.getRecordingTime();
}

/*Erase event */
function Erase(x, y) {
  this.type = "e";
  this.coord = [x, y];
  this.height = 10;
  this.width = 10;
  this.time = XB.getRecordingTime();
}

/*Clear event */
function Clear() {
  this.type = "l";
  this.time = XB.getRecordingTime();
}

/* Stroke style event */
function StrokeStyle(color) {
  this.type = "s";
  this.color = color;
  if (XB.recording) {
    this.time = XB.getRecordingTime();
  } else {
    // StrokeStyle can be called when not recording
    this.time = XB.lastEndTime - XB.subtractTime;
  }
}
/* === END Event objects === */

/**
 * ====================
 *    STATIC CONTROL
 * ====================
 */
window.XB = {

    context: null,
    canvas: null,
    type: '',
    coord: [0,0],
    events: [],
    animIndex: 0, // next in queue
    recording: false,
    recordingTime: 0,
    lastEndTime: 0,
    subtractTime: 0,
    recordClockInterval: null,
    playbackClockTimeout: null,
    playbackClock: 0,
    isPlaying: false,
    sampleRate: 250, // ms increments for clock intervals
    animateTimeout: null,
    drawColor: '#000000',
    uniqueID: null,
    lineWidth: 3,

    /**
     * Initializes the script by setting the default
     * values for parameters of the class.
     *
     * @param canvasid The id of the canvas element used
     */
    init: function(canvasid) {
      // set the canvas width and height
      // the offsetWidth and Height is default width and height
      this.canvas = document.getElementById(canvasid);
      this.canvas.width = this.canvas.offsetWidth;
      this.canvas.height = this.canvas.offsetHeight;

      this.context = this.canvas.getContext('2d');

      //initial values for the drawing context
      this.context.lineWidth = XB.lineWidth;
      this.context.lineCap = "square";

      // Initialize the selected color and add it as the first event
      XB.setStrokeStyle(XB.drawColor);

    },

    /**
     * Executes the event that matches the given event
     * object
     *
     * @param xbevent The event object to be executed.
     * @param firstexecute tells the function if the event is new and
     *          should be saved to this.events
     * This object should be one of the model's event objects.
     */
    execute: function(xbevent){
      var type = xbevent.type;
      var wid;
      var hei;
      var tmp;

      // Only push and save if we're recording
      if (XB.recording){
        XB.events.push(xbevent);
      }

      if(type === "b") {
        this.context.beginPath();
        this.context.moveTo(xbevent.coord[0],
                       xbevent.coord[1]);
        this.context.stroke();
      } else if (type === "d") {
        this.context.lineTo(xbevent.coord[0],
                       xbevent.coord[1]);
        this.context.stroke();
      } else if (type === "c") {
        this.context.closePath();
      } else if(type === "s") {
        this.context.strokeStyle = xbevent.color;
      } else if (type === "e") {
        this.context.clearRect(xbevent.coord[0],
                               xbevent.coord[1],
                               xbevent.width,
                               xbevent.height);
      } else if (type === "l") {
        XB.context.clearRect(0,0,XB.canvas.width,XB.canvas.height);
      }

    },


    /**
     * Resolves the relative width and height of the canvas
     * element. Relative parameters can vary depending on the
     * zoom. Both are equal to 1 if no zoom is encountered.
     *
     * @return An array containing the relative width as first
     * element and relative height as second.
     */
    getRelative: function() {
      return {width: this.canvas.width/this.canvas.offsetWidth,
          height: this.canvas.height/this.canvas.offsetHeight};
    },

    /* === BEGIN ACTIONS === */

    /**
     * Starts the animation action in the canvas from start. This clears
     * the whole canvas and starts to execute actions from
     * the action stack by calling XB.animateNext().
     * Will reset playback clock as well.
     */
    animate: function() {
      XB.setPlaybackClock(0);
      XB.animIndex = 0;
      XB.context.clearRect(0,0,XB.canvas.width,XB.canvas.height);
      if (XB.events.length > 0) {
        XB.animateNext(XB.events[0].time);
      }
    },

    /**
     * Animates the next event in the event
     * stack and waits for the amount of time between the
     * current and next event before calling itself again.
     * If a time argument is passed in, it is essentially a
     * delay on the calling of the function. It calls itself
     * again by setting a timeout.
     */
    animateNext: function(delay) {
      if (!(typeof delay === "undefined")) {
        XB.animateTimeout = setTimeout(XB.animateNext);
      } else {
        if (XB.animIndex === 0) {
          XB.animateTimeout = setTimeout(function(){
            XB.execute(XB.events[0]);
          }, XB.events[0].time);
        } else {
          XB.execute(XB.events[XB.animIndex]);
        }
        XB.animIndex++;
        if (XB.animIndex < XB.events.length - 1) {
          var diffTime = XB.events[XB.animIndex].time - XB.events[XB.animIndex - 1].time;
          XB.animateTimeout = setTimeout(XB.animateNext, diffTime);
        } else {
          // we've reached the end, decrement back down
          XB.animIndex--;
        }
      }
    },


    /* Called when someone clicks or moves the scrubber
     *
     * @param time: The time in ms of playback jumped to.
     *
     */
    jump: function(time){
      XB.redraw(time);
      // stop the old playbackClockTimeout and start a new one at our new time
      clearTimeout(XB.playbackClockTimeout);
      if (XB.isPlaying) {
        XB.animateNext(XB.events[XB.animIndex].time - time);
      }
      XB.setPlaybackClock(time);
    },

    /* Stops playback and playback clock */
    pause: function(){
      XB.isPlaying = false;
      clearTimeout(XB.animateTimeout);
      clearTimeout(XB.playbackClockTimeout);
    },

    /* Start clock again and continue animating from the proper index */
    play: function(){
      XB.isPlaying = true;
      if (XB.playbackEnd()) {
        XB.animate();
      } else {
        XB.setPlaybackClock();

        // only animate if we haven't played all the events yet
        if (!XB.eventsEnd()){
          XB.animateNext(XB.events[XB.animIndex].time - XB.playbackClock);
        }
      }
    },

    /* Start recording */
    record: function(){
      // if in middle of playback and you record, go back to the end of the
      // recording, only supporting appending for records
      if (!XB.playbackEnd()) {
        XB.redraw();
      }
      XB.recording = true;
      XB.subtractTime += (new Date().getTime() - XB.lastEndTime);
      XBUI.setClockInterval();
    },

    /* Stop recording */
    pauseRecord: function(){
      XB.recording = false;
      // keep track of this to make one smooth timeline even if we stop
      // and start recording sporadically.
      XB.lastEndTime = new Date().getTime();
      // playback clock should be same as recording time when we stop recording
      XB.playbackClock = XB.getRecordingTime();
      clearInterval(XB.recordClockInterval);
    },

    /** Canvas/Recording Functions **/

    /**
     * Begins a drawing path.
     *
     * @param x Coordinate x of the path starting point
     * @param y Coordinate y of the path starting point
     */
    beginPencilDraw: function(x, y) {
      var e = new BeginPath(x, y);
      XB.execute(e);
    },

    endPencilDraw: function(){
      var e = new ClosePath();
      XB.execute(e);
    },

    /**
     * Draws a path from the path starting point to the
     * point indicated by the given parameters.
     *
     * @param x Coordinate x of the path ending point
     * @param y Coordinate y of the path ending point
     */
    pencilDraw: function(x, y) {
        var e = new DrawPathToPoint(x, y);
        XB.execute(e);
    },

    /**
     * Begins erasing path.
     *
     * @param x Coordinate x of the path starting point
     * @param y Coordinate y of the path starting point
     */
    beginErasing: function(x, y) {
        var e = new BeginPath(x, y);
        XB.execute(e);
    },

    /**
     * Erases the point indicated by the given coordinates.
     * Actually this doesn't take the path starting point
     * into account but erases a rectangle at the given
     * coordinates with width and height specified in the
     * Erase object.
     *
     * @param x Coordinate x of the path ending point
     * @param y Coordinate y of the path ending point
     */
    erasePoint: function(x, y) {
        var e = new Erase(x, y);
        XB.execute(e);
    },

    /**
     * Clears the entire canvas
     */
    clear: function(){
      var e = new Clear();
      XB.execute(e);
    },

    /** END Canvas/Recording Functions **/

    /**
     * This function redraws the entire canvas
     * according to the events in XB.events.
     *
     * @param time: the time in playback to redraw up to in ms.
     *              if undefined, redraw everything
    */
    redraw: function(time) {
      // Only redraw the entire board if we're going backwards from our current state
      if (!(typeof time === "undefined" || time >= XB.playbackClock)) {
        XB.animIndex = 0;
        XB.context.clearRect(0,0,XB.canvas.width,XB.canvas.height);
      }
      // This code is verbose, but better for performance by reducing the number
      // of conditions checked in the loop
      if (typeof time === "undefined") {
        for (XB.animIndex; XB.animIndex < XB.events.length; XB.animIndex++){
          XB.execute(XB.events[XB.animIndex]);
        }
      } else { //redraw only up to time
        for (XB.animIndex; XB.animIndex < XB.events.length; XB.animIndex++){
          if (XB.events[XB.animIndex].time >= time){
            break;
          } else {
            XB.execute(XB.events[XB.animIndex]);
          }
        }
      }

      // If we got to the end, our animIndex is out of bounds now, decrement
      // TODO: Make this more elegant
      if (XB.animIndex == XB.events.length) {
        XB.animIndex--;
      }
    },

   /**
     * Sets stroke style for the canvas. Stroke
     * style defines the color with which every
     * stroke should be drawn on the canvas.
     *
     * @param color The wanted stroke color
    */
    setStrokeStyle: function(color) {
      var e = new StrokeStyle(color);
      XB.execute(e);
      // Always push changes in stroke style if not playing
      // Push here, not in execute, because then redraw would
      // be pushing StrokeStyle events into XB.events.
      if (!XB.isPlaying) {
        XB.events.push(e);
      }
    },

    /* === END ACTIONS === */

    /**
     * Wrapper around drawing functions, we want to make sure
     * recording is on first before anything gets executed.
     *
     * @param function_name: name of XB function we want to call
     * @param x: x coordinate, optional
     * @param y: y coordinate, optional
     */
    canvasFunction: function(function_name, x, y){
      if (XB.recording) {
        executeFunctionByName(function_name, XB, x, y);
      }
    },

    /* Creates a dictionary with all state important variables and
       CJSON and LZW compresses it before storing in a user specified
       data store.*/
    save: function(){
      // Generate a unique ID if this is a new video. Only generate when saving.
      // Store it in data for redundancy and error checking.
      if (!XB.uniqueID) {
        XB.uniqueID = XB.genUniqueID();
      }

      var data = {
        'uniqueID'      : XB.uniqueID,
        'recordingTime' : XB.recordingTime,
        'subtractTime'  : XB.subtractTime,
        'lastEndTime'   : XB.lastEndTime,
        'strokeColor'   : XB.context.strokeStyle,
        'events'        : XB.events
      };

      data = lzw_encode(CJSON.stringify(data));

      if (XB.saveToDatabase(data)) {
        alert("Successfully saved.");
      } else {
        alert("Error while saving.");
      }
    },

    /* Save the data to your datastore of choice.
       As it is easy for a hacker to retrieve recording tools
       from an embed and manipulate the video, make sure you have
       proper authentification before you save anything to a DB.
       @return: true on success, false on failure.                */
    saveToDatabase: function(data){
      // TODO: YOUR IMPLEMENTATION HERE
    },

    /** Restores the state of the canvas from saved compressed data.
     *
     *  @param uniqueID: unique 11 char ID of video we want to load
     */
    restore: function(uniqueID){
      // Uncomment below to use with a real database
      // var data = XB.restoreFromDatabase(uniqueID);
      // data = CJSON.parse(lzw_decode(data));

      // TODO: CJSON formatted data for example purposes. LZW compressed string can't be
      // pasted in. Needs to be pulled from a data store. Delete when implemented.

      var data = '{"f":"cjson","t":[[0,"type"],[1,"time"],[1,"color","time"],[1,"coord","time"],[0,"coord","type","time"],[0,"uniqueID","recordingTime","subtractTime","lastEndTime","strokeColor","events"]],"v":{"":[6,"16f49dIeflx",60128,1336986972704,1336987032903,"#008000",[{"":[3,"s","#000000",0]},{"":[5,[100,181],"b",3257]},{"":[4,"d",[101,181],3325]},{"":[4,"d",[105,181],3342]},{"":[4,"d",[107,181],3358]},{"":[4,"d",[111,181],3375]},{"":[4,"d",[116,181],3392]},{"":[4,"d",[119,182],3408]},{"":[4,"d",[124,182],3425]},{"":[4,"d",[127,182],3442]},{"":[4,"d",[129,182],3459]},{"":[4,"d",[130,182],3475]},{"":[4,"d",[131,182],3509]},{"":[4,"d",[132,182],3525]},{"":[4,"d",[133,182],3542]},{"":[4,"d",[134,182],3559]},{"":[4,"d",[135,182],3575]},{"":[4,"d",[136,182],3608]},{"":[4,"d",[138,182],3659]},{"":[2,"c",3736]},{"":[5,[73,211],"b",4416]},{"":[4,"d",[74,211],4426]},{"":[4,"d",[79,211],4443]},{"":[4,"d",[82,211],4459]},{"":[4,"d",[89,212],4476]},{"":[4,"d",[96,212],4493]},{"":[4,"d",[102,213],4510]},{"":[4,"d",[107,213],4526]},{"":[4,"d",[113,214],4547]},{"":[4,"d",[121,214],4563]},{"":[4,"d",[124,214],4580]},{"":[4,"d",[129,214],4597]},{"":[4,"d",[135,214],4614]},{"":[4,"d",[141,216],4631]},{"":[4,"d",[145,216],4648]},{"":[4,"d",[148,216],4663]},{"":[4,"d",[152,216],4681]},{"":[4,"d",[154,216],4697]},{"":[4,"d",[156,216],4714]},{"":[4,"d",[158,216],4730]},{"":[4,"d",[159,216],4747]},{"":[4,"d",[160,216],4763]},{"":[4,"d",[161,216],4780]},{"":[4,"d",[162,216],4798]},{"":[4,"d",[163,216],4815]},{"":[4,"d",[164,216],4831]},{"":[4,"d",[165,216],4847]},{"":[4,"d",[166,216],4865]},{"":[4,"d",[167,216],4880]},{"":[4,"d",[168,216],4914]},{"":[4,"d",[169,216],4931]},{"":[2,"c",5080]},{"":[5,[120,213],"b",5632]},{"":[4,"d",[120,214],5644]},{"":[4,"d",[121,215],5660]},{"":[4,"d",[121,217],5677]},{"":[4,"d",[121,220],5694]},{"":[4,"d",[121,222],5711]},{"":[4,"d",[121,224],5727]},{"":[4,"d",[122,231],5743]},{"":[4,"d",[123,235],5760]},{"":[4,"d",[124,240],5777]},{"":[4,"d",[124,244],5798]},{"":[4,"d",[125,247],5814]},{"":[4,"d",[125,251],5832]},{"":[4,"d",[125,254],5848]},{"":[4,"d",[125,259],5865]},{"":[4,"d",[125,264],5881]},{"":[4,"d",[125,267],5897]},{"":[4,"d",[125,269],5915]},{"":[4,"d",[125,270],5931]},{"":[4,"d",[125,272],5948]},{"":[4,"d",[125,273],5965]},{"":[4,"d",[125,274],5982]},{"":[4,"d",[125,275],5999]},{"":[4,"d",[125,276],6027]},{"":[4,"d",[125,278],6044]},{"":[4,"d",[125,279],6064]},{"":[4,"d",[125,280],6082]},{"":[4,"d",[125,281],6098]},{"":[4,"d",[125,282],6114]},{"":[4,"d",[125,283],6131]},{"":[4,"d",[125,284],6161]},{"":[4,"d",[125,286],6177]},{"":[4,"d",[125,287],6194]},{"":[4,"d",[125,288],6227]},{"":[4,"d",[129,288],6411]},{"":[4,"d",[136,288],6428]},{"":[4,"d",[142,289],6444]},{"":[4,"d",[148,289],6461]},{"":[4,"d",[152,289],6477]},{"":[4,"d",[155,289],6494]},{"":[4,"d",[158,289],6511]},{"":[4,"d",[165,289],6528]},{"":[4,"d",[174,289],6544]},{"":[4,"d",[183,289],6561]},{"":[4,"d",[190,289],6578]},{"":[4,"d",[198,289],6594]},{"":[4,"d",[203,289],6611]},{"":[4,"d",[209,289],6628]},{"":[4,"d",[212,289],6645]},{"":[4,"d",[215,289],6661]},{"":[4,"d",[217,289],6678]},{"":[4,"d",[221,289],6695]},{"":[4,"d",[225,289],6711]},{"":[4,"d",[228,288],6728]},{"":[4,"d",[231,288],6745]},{"":[4,"d",[234,288],6761]},{"":[4,"d",[237,288],6778]},{"":[4,"d",[240,288],6794]},{"":[4,"d",[241,288],6815]},{"":[4,"d",[243,288],6832]},{"":[4,"d",[245,288],6848]},{"":[4,"d",[248,288],6865]},{"":[4,"d",[248,287],7112]},{"":[4,"d",[248,286],7128]},{"":[4,"d",[248,284],7145]},{"":[4,"d",[248,281],7161]},{"":[4,"d",[248,279],7178]},{"":[4,"d",[248,274],7195]},{"":[4,"d",[248,272],7211]},{"":[4,"d",[248,269],7228]},{"":[4,"d",[248,268],7246]},{"":[4,"d",[248,265],7261]},{"":[4,"d",[248,262],7278]},{"":[4,"d",[248,258],7295]},{"":[4,"d",[248,256],7312]},{"":[4,"d",[249,252],7328]},{"":[4,"d",[250,250],7345]},{"":[4,"d",[250,246],7361]},{"":[4,"d",[251,241],7378]},{"":[4,"d",[251,238],7395]},{"":[4,"d",[252,235],7411]},{"":[4,"d",[252,232],7428]},{"":[4,"d",[252,231],7445]},{"":[4,"d",[252,229],7462]},{"":[4,"d",[252,228],7478]},{"":[4,"d",[253,228],7528]},{"":[4,"d",[251,227],7645]},{"":[4,"d",[246,225],7662]},{"":[4,"d",[241,224],7678]},{"":[4,"d",[239,224],7695]},{"":[4,"d",[238,223],7712]},{"":[4,"d",[237,222],7778]},{"":[4,"d",[235,222],7795]},{"":[4,"d",[235,221],7812]},{"":[4,"d",[235,220],7929]},{"":[4,"d",[236,219],7946]},{"":[4,"d",[240,218],7962]},{"":[4,"d",[245,215],7979]},{"":[4,"d",[247,215],7995]},{"":[4,"d",[250,214],8012]},{"":[4,"d",[251,213],8029]},{"":[4,"d",[252,213],8046]},{"":[4,"d",[253,212],8079]},{"":[4,"d",[254,212],8095]},{"":[4,"d",[255,212],8112]},{"":[4,"d",[255,211],8146]},{"":[4,"d",[255,211],8179]},{"":[4,"d",[255,210],8246]},{"":[4,"d",[255,208],8263]},{"":[4,"d",[255,208],8296]},{"":[4,"d",[251,207],8312]},{"":[4,"d",[249,206],8329]},{"":[4,"d",[243,205],8346]},{"":[4,"d",[240,203],8363]},{"":[4,"d",[238,203],8379]},{"":[4,"d",[237,203],8397]},{"":[4,"d",[236,202],8429]},{"":[4,"d",[235,202],8446]},{"":[4,"d",[234,201],8462]},{"":[4,"d",[232,200],8486]},{"":[4,"d",[232,200],8513]},{"":[4,"d",[232,199],8579]},{"":[4,"d",[233,199],8629]},{"":[4,"d",[237,198],8646]},{"":[4,"d",[239,198],8663]},{"":[4,"d",[244,197],8679]},{"":[4,"d",[248,197],8696]},{"":[4,"d",[253,195],8729]},{"":[4,"d",[255,194],8746]},{"":[4,"d",[255,194],8779]},{"":[4,"d",[256,194],8797]},{"":[4,"d",[257,194],8830]},{"":[4,"d",[258,193],8847]},{"":[4,"d",[258,192],8929]},{"":[4,"d",[258,191],8964]},{"":[4,"d",[255,190],8980]},{"":[4,"d",[246,189],8996]},{"":[4,"d",[241,188],9013]},{"":[4,"d",[237,188],9029]},{"":[4,"d",[234,187],9046]},{"":[4,"d",[233,186],9063]},{"":[4,"d",[230,185],9080]},{"":[4,"d",[229,185],9096]},{"":[4,"d",[227,184],9130]},{"":[4,"d",[225,184],9180]},{"":[4,"d",[225,182],9264]},{"":[4,"d",[226,182],9280]},{"":[4,"d",[229,181],9297]},{"":[4,"d",[231,180],9315]},{"":[4,"d",[236,180],9331]},{"":[4,"d",[239,179],9347]},{"":[4,"d",[242,179],9363]},{"":[4,"d",[243,179],9380]},{"":[4,"d",[245,179],9397]},{"":[4,"d",[246,179],9413]},{"":[4,"d",[248,179],9430]},{"":[4,"d",[250,177],9446]},{"":[4,"d",[251,177],9463]},{"":[4,"d",[253,176],9480]},{"":[4,"d",[254,176],9513]},{"":[4,"d",[255,175],9531]},{"":[4,"d",[257,175],9547]},{"":[4,"d",[258,175],9563]},{"":[4,"d",[258,174],9647]},{"":[4,"d",[258,173],9680]},{"":[4,"d",[257,173],9697]},{"":[4,"d",[256,172],9714]},{"":[4,"d",[254,172],9730]},{"":[4,"d",[251,170],9747]},{"":[4,"d",[248,169],9764]},{"":[4,"d",[246,168],9780]},{"":[4,"d",[245,168],9797]},{"":[4,"d",[245,167],9814]},{"":[4,"d",[242,167],9830]},{"":[4,"d",[240,166],9847]},{"":[4,"d",[239,165],9864]},{"":[4,"d",[238,165],9930]},{"":[4,"d",[239,165],10130]},{"":[4,"d",[240,165],10164]},{"":[4,"d",[241,165],10197]},{"":[4,"d",[241,164],10214]},{"":[4,"d",[242,163],10247]},{"":[4,"d",[242,162],10264]},{"":[4,"d",[243,162],10281]},{"":[4,"d",[244,161],10297]},{"":[4,"d",[244,159],10314]},{"":[4,"d",[244,157],10331]},{"":[4,"d",[244,155],10348]},{"":[4,"d",[244,153],10364]},{"":[4,"d",[244,152],10381]},{"":[4,"d",[244,149],10397]},{"":[4,"d",[243,148],10414]},{"":[4,"d",[243,147],10431]},{"":[4,"d",[243,146],10448]},{"":[4,"d",[243,145],10464]},{"":[4,"d",[242,143],10498]},{"":[4,"d",[242,142],10514]},{"":[4,"d",[242,140],10531]},{"":[4,"d",[242,138],10548]},{"":[4,"d",[242,137],10564]},{"":[4,"d",[242,136],10581]},{"":[4,"d",[241,134],10597]},{"":[4,"d",[241,133],10614]},{"":[4,"d",[240,132],10631]},{"":[4,"d",[240,129],10648]},{"":[4,"d",[239,127],10664]},{"":[4,"d",[238,124],10681]},{"":[4,"d",[238,121],10698]},{"":[4,"d",[238,120],10715]},{"":[4,"d",[238,119],10731]},{"":[4,"d",[238,118],10748]},{"":[4,"d",[238,117],10764]},{"":[4,"d",[238,116],10781]},{"":[4,"d",[238,113],10798]},{"":[4,"d",[237,112],10814]},{"":[4,"d",[237,111],10836]},{"":[4,"d",[237,109],10851]},{"":[4,"d",[237,108],10881]},{"":[4,"d",[237,107],10898]},{"":[4,"d",[237,106],10931]},{"":[4,"d",[237,105],10948]},{"":[4,"d",[236,104],11148]},{"":[4,"d",[234,103],11164]},{"":[4,"d",[231,103],11181]},{"":[4,"d",[227,102],11198]},{"":[4,"d",[223,102],11215]},{"":[4,"d",[218,101],11231]},{"":[4,"d",[214,101],11248]},{"":[4,"d",[209,101],11265]},{"":[4,"d",[205,101],11281]},{"":[4,"d",[201,101],11298]},{"":[4,"d",[199,101],11315]},{"":[4,"d",[195,101],11332]},{"":[4,"d",[191,101],11348]},{"":[4,"d",[188,101],11365]},{"":[4,"d",[184,101],11382]},{"":[4,"d",[182,101],11399]},{"":[4,"d",[180,101],11432]},{"":[4,"d",[177,101],11448]},{"":[4,"d",[175,101],11465]},{"":[4,"d",[173,101],11482]},{"":[4,"d",[171,101],11499]},{"":[4,"d",[169,101],11515]},{"":[4,"d",[165,101],11532]},{"":[4,"d",[163,101],11548]},{"":[4,"d",[159,101],11565]},{"":[4,"d",[157,102],11582]},{"":[4,"d",[155,102],11598]},{"":[4,"d",[153,102],11616]},{"":[4,"d",[152,102],11632]},{"":[4,"d",[150,102],11649]},{"":[4,"d",[148,102],11665]},{"":[4,"d",[146,102],11682]},{"":[4,"d",[145,102],11698]},{"":[4,"d",[143,102],11716]},{"":[4,"d",[142,102],11732]},{"":[4,"d",[141,102],11749]},{"":[4,"d",[139,102],11765]},{"":[4,"d",[135,102],11782]},{"":[4,"d",[129,101],11798]},{"":[4,"d",[127,101],11815]},{"":[4,"d",[126,101],11882]},{"":[4,"d",[124,101],11899]},{"":[4,"d",[123,101],11999]},{"":[4,"d",[122,101],12015]},{"":[4,"d",[120,101],12065]},{"":[4,"d",[119,102],12099]},{"":[4,"d",[119,104],12216]},{"":[4,"d",[119,105],12232]},{"":[4,"d",[119,106],12249]},{"":[4,"d",[119,109],12265]},{"":[4,"d",[119,111],12283]},{"":[4,"d",[119,115],12299]},{"":[4,"d",[119,119],12316]},{"":[4,"d",[118,124],12335]},{"":[4,"d",[117,128],12349]},{"":[4,"d",[116,131],12366]},{"":[4,"d",[116,135],12382]},{"":[4,"d",[115,137],12399]},{"":[4,"d",[115,139],12416]},{"":[4,"d",[115,141],12432]},{"":[4,"d",[115,143],12449]},{"":[4,"d",[115,145],12466]},{"":[4,"d",[115,147],12482]},{"":[4,"d",[114,152],12500]},{"":[4,"d",[114,156],12516]},{"":[4,"d",[114,158],12534]},{"":[4,"d",[113,159],12549]},{"":[4,"d",[113,160],12566]},{"":[4,"d",[113,161],12583]},{"":[4,"d",[113,162],12603]},{"":[4,"d",[113,163],12632]},{"":[4,"d",[113,164],12650]},{"":[4,"d",[113,165],12682]},{"":[4,"d",[114,167],12749]},{"":[4,"d",[114,168],12782]},{"":[4,"d",[115,168],12800]},{"":[4,"d",[115,169],12833]},{"":[4,"d",[116,171],12866]},{"":[4,"d",[116,172],12899]},{"":[4,"d",[117,173],12933]},{"":[4,"d",[118,174],12949]},{"":[2,"c",13121]},{"":[3,"s","rgb(153, 51, 0)",16268]},{"":[3,"s","rgb(153, 51, 0)",16268]},{"":[5,[235,103],"b",17562]},{"":[4,"d",[237,103],17587]},{"":[4,"d",[242,103],17604]},{"":[4,"d",[250,103],17620]},{"":[4,"d",[255,103],17636]},{"":[4,"d",[262,104],17653]},{"":[4,"d",[268,104],17670]},{"":[4,"d",[275,105],17686]},{"":[4,"d",[285,107],17704]},{"":[4,"d",[293,107],17720]},{"":[4,"d",[301,109],17737]},{"":[4,"d",[305,110],17753]},{"":[4,"d",[311,111],17770]},{"":[4,"d",[316,111],17787]},{"":[4,"d",[318,112],17804]},{"":[4,"d",[322,113],17820]},{"":[4,"d",[324,113],17837]},{"":[4,"d",[327,114],17853]},{"":[4,"d",[329,114],17870]},{"":[4,"d",[331,114],17891]},{"":[4,"d",[333,114],17908]},{"":[4,"d",[335,114],17925]},{"":[4,"d",[336,114],17941]},{"":[4,"d",[337,114],17958]},{"":[4,"d",[338,114],17987]},{"":[4,"d",[340,114],18003]},{"":[4,"d",[341,114],18020]},{"":[4,"d",[342,114],18036]},{"":[4,"d",[343,114],18054]},{"":[4,"d",[345,114],18071]},{"":[4,"d",[347,114],18103]},{"":[4,"d",[348,114],18121]},{"":[4,"d",[349,114],18137]},{"":[4,"d",[350,114],18154]},{"":[4,"d",[351,114],18287]},{"":[4,"d",[352,114],18371]},{"":[4,"d",[354,114],18420]},{"":[4,"d",[355,115],18637]},{"":[4,"d",[356,116],18654]},{"":[4,"d",[356,120],18671]},{"":[4,"d",[357,123],18688]},{"":[4,"d",[358,127],18704]},{"":[4,"d",[359,129],18721]},{"":[4,"d",[359,131],18738]},{"":[4,"d",[359,132],18754]},{"":[4,"d",[359,134],18771]},{"":[4,"d",[360,134],18787]},{"":[4,"d",[360,135],18804]},{"":[4,"d",[360,136],18821]},{"":[4,"d",[361,138],18838]},{"":[4,"d",[361,139],18855]},{"":[4,"d",[361,141],18871]},{"":[4,"d",[362,143],18888]},{"":[4,"d",[362,144],18904]},{"":[4,"d",[363,145],18921]},{"":[4,"d",[363,146],18938]},{"":[4,"d",[364,147],18955]},{"":[4,"d",[364,148],18971]},{"":[4,"d",[364,150],18988]},{"":[4,"d",[364,152],19004]},{"":[4,"d",[364,153],19021]},{"":[4,"d",[364,154],19037]},{"":[4,"d",[364,156],19054]},{"":[4,"d",[364,157],19071]},{"":[4,"d",[365,158],19088]},{"":[4,"d",[365,159],19104]},{"":[4,"d",[365,160],19121]},{"":[4,"d",[365,162],19154]},{"":[4,"d",[365,163],19171]},{"":[4,"d",[365,164],19188]},{"":[4,"d",[363,164],19338]},{"":[4,"d",[355,165],19355]},{"":[4,"d",[348,165],19371]},{"":[4,"d",[337,165],19388]},{"":[4,"d",[329,166],19404]},{"":[4,"d",[321,167],19421]},{"":[4,"d",[316,167],19439]},{"":[4,"d",[313,168],19455]},{"":[4,"d",[311,168],19472]},{"":[4,"d",[310,169],19571]},{"":[4,"d",[313,170],19588]},{"":[4,"d",[321,172],19605]},{"":[4,"d",[330,175],19622]},{"":[4,"d",[342,178],19638]},{"":[4,"d",[353,180],19655]},{"":[4,"d",[361,183],19672]},{"":[4,"d",[365,184],19689]},{"":[4,"d",[367,185],19705]},{"":[4,"d",[367,185],19822]},{"":[4,"d",[365,186],19839]},{"":[4,"d",[364,187],19855]},{"":[4,"d",[358,188],19872]},{"":[4,"d",[350,191],19888]},{"":[4,"d",[339,193],19906]},{"":[4,"d",[332,195],19922]},{"":[4,"d",[324,197],19938]},{"":[4,"d",[323,199],19955]},{"":[4,"d",[322,200],19972]},{"":[4,"d",[321,200],20071]},{"":[4,"d",[325,200],20155]},{"":[4,"d",[328,201],20172]},{"":[4,"d",[336,202],20188]},{"":[4,"d",[348,204],20205]},{"":[4,"d",[357,205],20222]},{"":[4,"d",[363,206],20239]},{"":[4,"d",[367,207],20255]},{"":[4,"d",[369,207],20339]},{"":[4,"d",[367,207],20439]},{"":[4,"d",[365,207],20455]},{"":[4,"d",[357,207],20472]},{"":[4,"d",[347,208],20489]},{"":[4,"d",[339,208],20506]},{"":[4,"d",[335,208],20522]},{"":[4,"d",[333,209],20539]},{"":[4,"d",[331,209],20556]},{"":[4,"d",[328,209],20572]},{"":[4,"d",[326,209],20589]},{"":[4,"d",[327,210],20739]},{"":[4,"d",[331,210],20756]},{"":[4,"d",[337,212],20773]},{"":[4,"d",[342,212],20789]},{"":[4,"d",[345,213],20806]},{"":[4,"d",[347,213],20822]},{"":[4,"d",[348,214],20839]},{"":[4,"d",[348,215],21039]},{"":[4,"d",[348,216],21089]},{"":[4,"d",[348,217],21122]},{"":[4,"d",[348,219],21141]},{"":[4,"d",[348,221],21156]},{"":[4,"d",[348,224],21172]},{"":[4,"d",[348,225],21189]},{"":[4,"d",[348,226],21206]},{"":[4,"d",[348,227],21223]},{"":[4,"d",[348,228],21240]},{"":[4,"d",[349,229],21256]},{"":[4,"d",[349,230],21273]},{"":[4,"d",[349,232],21290]},{"":[4,"d",[349,234],21307]},{"":[4,"d",[349,238],21323]},{"":[4,"d",[349,240],21340]},{"":[4,"d",[349,244],21357]},{"":[4,"d",[349,247],21373]},{"":[4,"d",[349,249],21390]},{"":[4,"d",[349,252],21407]},{"":[4,"d",[349,254],21423]},{"":[4,"d",[349,256],21439]},{"":[4,"d",[348,258],21457]},{"":[4,"d",[348,260],21473]},{"":[4,"d",[348,263],21489]},{"":[4,"d",[347,265],21506]},{"":[4,"d",[346,266],21523]},{"":[4,"d",[346,269],21540]},{"":[4,"d",[346,271],21557]},{"":[4,"d",[345,272],21573]},{"":[4,"d",[345,274],21590]},{"":[4,"d",[344,275],21606]},{"":[4,"d",[344,276],21623]},{"":[4,"d",[344,277],21640]},{"":[4,"d",[344,277],21673]},{"":[4,"d",[344,279],21706]},{"":[4,"d",[344,281],21723]},{"":[4,"d",[344,282],21857]},{"":[4,"d",[344,283],21873]},{"":[4,"d",[344,284],21907]},{"":[4,"d",[344,285],22023]},{"":[4,"d",[343,286],22090]},{"":[4,"d",[341,286],22106]},{"":[4,"d",[335,286],22123]},{"":[4,"d",[328,287],22140]},{"":[4,"d",[320,287],22157]},{"":[4,"d",[315,287],22173]},{"":[4,"d",[310,288],22190]},{"":[4,"d",[306,288],22207]},{"":[4,"d",[302,288],22224]},{"":[4,"d",[298,288],22241]},{"":[4,"d",[293,288],22257]},{"":[4,"d",[288,288],22274]},{"":[4,"d",[286,288],22291]},{"":[4,"d",[283,288],22307]},{"":[4,"d",[279,288],22324]},{"":[4,"d",[278,288],22340]},{"":[4,"d",[276,288],22358]},{"":[4,"d",[274,288],22374]},{"":[4,"d",[272,288],22391]},{"":[4,"d",[271,288],22411]},{"":[4,"d",[269,289],22428]},{"":[4,"d",[268,289],22444]},{"":[4,"d",[267,289],22461]},{"":[4,"d",[265,289],22478]},{"":[4,"d",[264,289],22495]},{"":[4,"d",[262,289],22511]},{"":[4,"d",[260,289],22528]},{"":[4,"d",[260,289],22557]},{"":[4,"d",[259,289],22574]},{"":[4,"d",[258,289],22590]},{"":[4,"d",[255,289],22607]},{"":[4,"d",[253,289],22624]},{"":[4,"d",[253,290],22640]},{"":[4,"d",[252,290],22661]},{"":[4,"d",[251,290],22678]},{"":[4,"d",[250,290],22695]},{"":[4,"d",[249,290],22712]},{"":[4,"d",[248,290],22728]},{"":[4,"d",[247,291],22745]},{"":[4,"d",[246,291],22774]},{"":[4,"d",[246,291],22824]},{"":[2,"c",22970]},{"":[3,"s","rgb(255, 0, 0)",29285]},{"":[3,"s","rgb(255, 0, 0)",29285]},{"":[5,[40,164],"b",30068]},{"":[4,"d",[40,165],30080]},{"":[4,"d",[40,166],30096]},{"":[4,"d",[40,167],30113]},{"":[4,"d",[40,168],30130]},{"":[4,"d",[40,169],30146]},{"":[4,"d",[37,172],30163]},{"":[4,"d",[34,175],30180]},{"":[4,"d",[30,179],30196]},{"":[4,"d",[28,181],30213]},{"":[4,"d",[28,182],30230]},{"":[4,"d",[28,183],30263]},{"":[4,"d",[28,184],30280]},{"":[4,"d",[31,185],30296]},{"":[4,"d",[36,187],30314]},{"":[4,"d",[45,189],30330]},{"":[4,"d",[54,192],30346]},{"":[4,"d",[58,195],30363]},{"":[4,"d",[60,196],30380]},{"":[4,"d",[60,199],30397]},{"":[4,"d",[61,199],30413]},{"":[4,"d",[61,200],30430]},{"":[4,"d",[61,201],30448]},{"":[4,"d",[61,202],30464]},{"":[4,"d",[61,204],30497]},{"":[4,"d",[61,205],30513]},{"":[4,"d",[59,205],30530]},{"":[4,"d",[54,206],30547]},{"":[4,"d",[47,206],30564]},{"":[4,"d",[42,206],30580]},{"":[4,"d",[36,206],30597]},{"":[4,"d",[33,206],30614]},{"":[4,"d",[31,206],30630]},{"":[4,"d",[29,206],30647]},{"":[4,"d",[27,206],30663]},{"":[4,"d",[25,206],30697]},{"":[4,"d",[25,205],30714]},{"":[2,"c",30763]},{"":[5,[34,162],"b",31236]},{"":[4,"d",[36,162],31247]},{"":[4,"d",[37,162],31264]},{"":[4,"d",[39,162],31281]},{"":[4,"d",[43,162],31297]},{"":[4,"d",[47,162],31314]},{"":[4,"d",[52,162],31332]},{"":[4,"d",[56,162],31347]},{"":[4,"d",[59,161],31364]},{"":[4,"d",[61,160],31381]},{"":[2,"c",31451]},{"":[5,[61,175],"b",31876]},{"":[4,"d",[62,177],31882]},{"":[4,"d",[63,179],31898]},{"":[4,"d",[64,181],31914]},{"":[4,"d",[65,184],31931]},{"":[4,"d",[66,187],31948]},{"":[4,"d",[67,189],31969]},{"":[4,"d",[68,192],31985]},{"":[4,"d",[68,194],32002]},{"":[4,"d",[69,196],32018]},{"":[4,"d",[70,198],32036]},{"":[4,"d",[71,200],32053]},{"":[4,"d",[71,201],32069]},{"":[4,"d",[71,200],32265]},{"":[4,"d",[72,200],32282]},{"":[4,"d",[73,197],32298]},{"":[4,"d",[74,194],32315]},{"":[4,"d",[75,192],32331]},{"":[4,"d",[75,190],32350]},{"":[4,"d",[75,189],32365]},{"":[4,"d",[75,186],32381]},{"":[4,"d",[75,185],32398]},{"":[4,"d",[75,184],32415]},{"":[4,"d",[75,183],32431]},{"":[4,"d",[76,181],32449]},{"":[4,"d",[76,180],32470]},{"":[4,"d",[76,179],32486]},{"":[4,"d",[76,178],32503]},{"":[4,"d",[76,177],32532]},{"":[4,"d",[77,176],32548]},{"":[4,"d",[78,175],32565]},{"":[4,"d",[79,175],32699]},{"":[2,"c",32787]},{"":[3,"s","rgb(255, 204, 0)",38726]},{"":[3,"s","rgb(255, 204, 0)",38726]},{"":[5,[70,233],"b",41485]},{"":[4,"d",[70,236],41489]},{"":[4,"d",[70,237],41505]},{"":[4,"d",[70,240],41527]},{"":[4,"d",[70,242],41543]},{"":[4,"d",[70,244],41559]},{"":[4,"d",[70,246],41576]},{"":[4,"d",[70,248],41592]},{"":[4,"d",[70,250],41610]},{"":[4,"d",[71,252],41627]},{"":[4,"d",[71,256],41642]},{"":[4,"d",[71,259],41660]},{"":[4,"d",[71,262],41676]},{"":[4,"d",[71,264],41693]},{"":[4,"d",[71,267],41710]},{"":[4,"d",[71,269],41727]},{"":[4,"d",[71,271],41743]},{"":[4,"d",[71,272],41760]},{"":[4,"d",[71,274],41777]},{"":[4,"d",[71,276],41794]},{"":[4,"d",[71,280],41810]},{"":[4,"d",[72,282],41827]},{"":[4,"d",[72,283],41843]},{"":[4,"d",[72,284],41860]},{"":[4,"d",[72,286],41877]},{"":[4,"d",[73,288],41909]},{"":[4,"d",[73,289],41927]},{"":[4,"d",[74,290],41944]},{"":[4,"d",[75,291],41960]},{"":[4,"d",[76,293],41976]},{"":[4,"d",[76,296],41994]},{"":[4,"d",[77,297],42010]},{"":[4,"d",[78,298],42026]},{"":[4,"d",[79,300],42044]},{"":[4,"d",[80,303],42060]},{"":[4,"d",[80,305],42077]},{"":[4,"d",[82,309],42094]},{"":[4,"d",[84,311],42110]},{"":[4,"d",[87,313],42127]},{"":[4,"d",[99,320],42157]},{"":[4,"d",[103,322],42177]},{"":[4,"d",[106,323],42193]},{"":[4,"d",[110,325],42211]},{"":[4,"d",[114,327],42227]},{"":[4,"d",[120,327],42244]},{"":[4,"d",[123,328],42260]},{"":[4,"d",[127,329],42278]},{"":[4,"d",[131,331],42295]},{"":[4,"d",[136,331],42311]},{"":[4,"d",[141,332],42328]},{"":[4,"d",[146,332],42344]},{"":[4,"d",[150,332],42361]},{"":[4,"d",[154,332],42377]},{"":[4,"d",[158,332],42394]},{"":[4,"d",[161,332],42411]},{"":[4,"d",[165,332],42428]},{"":[4,"d",[167,332],42444]},{"":[4,"d",[169,332],42461]},{"":[4,"d",[170,332],42478]},{"":[4,"d",[172,332],42494]},{"":[4,"d",[174,332],42511]},{"":[4,"d",[175,332],42528]},{"":[4,"d",[177,332],42545]},{"":[2,"c",42708]},{"":[5,[156,312],"b",42997]},{"":[4,"d",[157,311],43007]},{"":[4,"d",[159,312],43024]},{"":[4,"d",[167,316],43040]},{"":[4,"d",[176,320],43058]},{"":[4,"d",[183,323],43073]},{"":[4,"d",[189,326],43090]},{"":[4,"d",[198,329],43107]},{"":[4,"d",[203,331],43124]},{"":[4,"d",[207,333],43140]},{"":[4,"d",[210,334],43157]},{"":[4,"d",[213,335],43173]},{"":[4,"d",[215,335],43190]},{"":[4,"d",[215,336],43290]},{"":[4,"d",[215,337],43308]},{"":[4,"d",[213,340],43341]},{"":[4,"d",[208,342],43357]},{"":[4,"d",[203,344],43374]},{"":[4,"d",[198,346],43391]},{"":[4,"d",[193,347],43407]},{"":[4,"d",[191,348],43424]},{"":[4,"d",[190,348],43440]},{"":[4,"d",[188,348],43474]},{"":[4,"d",[186,348],43491]},{"":[4,"d",[183,348],43507]},{"":[4,"d",[181,348],43524]},{"":[4,"d",[178,349],43557]},{"":[4,"d",[177,349],43574]},{"":[4,"d",[176,349],43591]},{"":[4,"d",[174,349],43607]},{"":[4,"d",[173,350],43624]},{"":[4,"d",[172,350],43641]},{"":[4,"d",[171,350],43674]},{"":[4,"d",[170,350],43691]},{"":[4,"d",[169,351],43707]},{"":[4,"d",[168,351],43724]},{"":[4,"d",[167,351],43740]},{"":[4,"d",[166,351],43824]},{"":[4,"d",[165,349],43908]},{"":[4,"d",[165,347],43924]},{"":[4,"d",[164,343],43941]},{"":[4,"d",[163,337],43958]},{"":[4,"d",[163,333],43974]},{"":[4,"d",[162,329],43992]},{"":[4,"d",[162,325],44007]},{"":[4,"d",[162,323],44024]},{"":[4,"d",[162,322],44045]},{"":[4,"d",[162,321],44062]},{"":[4,"d",[162,320],44108]},{"":[4,"d",[162,319],44124]},{"":[4,"d",[162,318],44141]},{"":[4,"d",[161,316],44158]},{"":[4,"d",[161,315],44224]},{"":[4,"d",[161,314],44242]},{"":[4,"d",[161,314],44274]},{"":[2,"c",44428]},{"":[5,[64,348],"b",46029]},{"":[4,"d",[66,348],46043]},{"":[4,"d",[67,348],46059]},{"":[4,"d",[68,348],46076]},{"":[4,"d",[70,347],46093]},{"":[4,"d",[72,346],46109]},{"":[4,"d",[73,345],46126]},{"":[4,"d",[75,344],46142]},{"":[4,"d",[77,344],46159]},{"":[4,"d",[79,344],46176]},{"":[4,"d",[80,344],46192]},{"":[4,"d",[82,344],46209]},{"":[4,"d",[83,344],46227]},{"":[4,"d",[85,346],46243]},{"":[4,"d",[86,347],46260]},{"":[4,"d",[87,349],46276]},{"":[4,"d",[89,352],46293]},{"":[4,"d",[91,356],46309]},{"":[4,"d",[92,357],46327]},{"":[4,"d",[93,358],46343]},{"":[4,"d",[93,359],46359]},{"":[4,"d",[93,361],46376]},{"":[4,"d",[94,363],46393]},{"":[4,"d",[94,365],46410]},{"":[4,"d",[94,368],46426]},{"":[4,"d",[94,370],46443]},{"":[4,"d",[94,374],46460]},{"":[4,"d",[94,376],46476]},{"":[4,"d",[91,379],46493]},{"":[4,"d",[87,382],46510]},{"":[4,"d",[84,383],46526]},{"":[4,"d",[78,384],46543]},{"":[4,"d",[74,384],46564]},{"":[4,"d",[71,384],46580]},{"":[4,"d",[69,384],46597]},{"":[4,"d",[67,384],46626]},{"":[4,"d",[67,383],46693]},{"":[4,"d",[66,381],46710]},{"":[4,"d",[66,379],46726]},{"":[4,"d",[66,378],46743]},{"":[4,"d",[66,377],46760]},{"":[4,"d",[66,376],46777]},{"":[4,"d",[67,375],46793]},{"":[4,"d",[69,374],46810]},{"":[4,"d",[71,374],46827]},{"":[4,"d",[73,373],46844]},{"":[4,"d",[74,373],46860]},{"":[4,"d",[75,373],46877]},{"":[4,"d",[77,373],46910]},{"":[4,"d",[81,374],46926]},{"":[4,"d",[89,379],46943]},{"":[4,"d",[95,384],46960]},{"":[4,"d",[102,388],46977]},{"":[4,"d",[105,391],46993]},{"":[4,"d",[110,394],47010]},{"":[4,"d",[112,395],47027]},{"":[4,"d",[113,396],47044]},{"":[2,"c",47141]},{"":[5,[114,389],"b",47461]},{"":[4,"d",[115,388],47510]},{"":[4,"d",[115,386],47527]},{"":[4,"d",[116,386],47543]},{"":[4,"d",[116,383],47561]},{"":[4,"d",[117,379],47578]},{"":[4,"d",[117,373],47594]},{"":[4,"d",[117,368],47610]},{"":[4,"d",[118,362],47627]},{"":[4,"d",[118,357],47644]},{"":[4,"d",[118,354],47660]},{"":[4,"d",[118,352],47677]},{"":[4,"d",[118,350],47744]},{"":[4,"d",[119,350],47761]},{"":[4,"d",[119,349],47777]},{"":[4,"d",[120,349],47794]},{"":[4,"d",[122,351],47894]},{"":[4,"d",[129,359],47910]},{"":[4,"d",[136,367],47927]},{"":[4,"d",[140,372],47944]},{"":[4,"d",[144,376],47961]},{"":[4,"d",[147,379],47978]},{"":[4,"d",[148,382],47994]},{"":[4,"d",[149,384],48011]},{"":[4,"d",[149,385],48028]},{"":[4,"d",[149,386],48061]},{"":[2,"c",48269]},{"":[5,[114,374],"b",48677]},{"":[4,"d",[115,374],48695]},{"":[4,"d",[119,374],48711]},{"":[4,"d",[124,374],48728]},{"":[4,"d",[127,374],48745]},{"":[4,"d",[131,374],48762]},{"":[4,"d",[132,374],48778]},{"":[4,"d",[133,374],48845]},{"":[4,"d",[136,374],49012]},{"":[4,"d",[137,374],49029]},{"":[2,"c",49213]},{"":[3,"s","rgb(0, 128, 0)",52639]},{"":[3,"s","rgb(0, 128, 0)",52639]},{"":[5,[391,173],"b",53214]},{"":[4,"d",[390,174],53248]},{"":[4,"d",[390,177],53265]},{"":[4,"d",[391,180],53281]},{"":[4,"d",[391,184],53298]},{"":[4,"d",[391,189],53315]},{"":[4,"d",[391,191],53332]},{"":[4,"d",[391,195],53348]},{"":[4,"d",[391,197],53365]},{"":[4,"d",[391,200],53382]},{"":[4,"d",[391,201],53399]},{"":[4,"d",[391,202],53415]},{"":[4,"d",[391,204],53548]},{"":[4,"d",[391,205],53565]},{"":[4,"d",[391,206],53582]},{"":[4,"d",[391,208],53615]},{"":[2,"c",53709]},{"":[5,[407,210],"b",53950]},{"":[4,"d",[408,210],53966]},{"":[4,"d",[409,210],53983]},{"":[4,"d",[411,210],53999]},{"":[4,"d",[414,210],54015]},{"":[4,"d",[421,210],54032]},{"":[4,"d",[425,210],54049]},{"":[4,"d",[430,210],54065]},{"":[4,"d",[435,210],54082]},{"":[4,"d",[436,210],54099]},{"":[4,"d",[439,210],54115]},{"":[4,"d",[443,210],54132]},{"":[4,"d",[445,210],54149]},{"":[4,"d",[446,210],54165]},{"":[4,"d",[446,210],54182]},{"":[4,"d",[447,210],54199]},{"":[4,"d",[447,209],54215]},{"":[4,"d",[447,208],54232]},{"":[4,"d",[447,206],54249]},{"":[4,"d",[446,205],54266]},{"":[4,"d",[445,201],54282]},{"":[4,"d",[441,197],54299]},{"":[4,"d",[438,194],54316]},{"":[4,"d",[434,191],54332]},{"":[4,"d",[432,189],54353]},{"":[4,"d",[432,187],54382]},{"":[4,"d",[432,186],54399]},{"":[4,"d",[432,185],54416]},{"":[4,"d",[435,184],54433]},{"":[4,"d",[438,183],54449]},{"":[4,"d",[442,182],54466]},{"":[4,"d",[446,181],54482]},{"":[4,"d",[451,181],54499]},{"":[4,"d",[456,181],54516]},{"":[4,"d",[460,181],54532]},{"":[4,"d",[463,183],54549]},{"":[4,"d",[464,184],54566]},{"":[4,"d",[466,185],54583]},{"":[4,"d",[467,188],54603]},{"":[4,"d",[469,190],54620]},{"":[4,"d",[469,191],54637]},{"":[4,"d",[470,193],54653]},{"":[4,"d",[470,195],54670]},{"":[4,"d",[470,197],54687]},{"":[4,"d",[470,198],54703]},{"":[4,"d",[470,199],54720]},{"":[4,"d",[470,200],54737]},{"":[4,"d",[470,200],54766]},{"":[4,"d",[470,201],54783]},{"":[4,"d",[470,202],54966]},{"":[4,"d",[469,203],55067]},{"":[4,"d",[468,205],55333]},{"":[4,"d",[467,206],55367]},{"":[4,"d",[467,207],55466]},{"":[4,"d",[467,207],55601]},{"":[4,"d",[467,208],55617]},{"":[4,"d",[466,209],55633]},{"":[4,"d",[470,210],55750]},{"":[4,"d",[473,211],55767]},{"":[4,"d",[483,213],55784]},{"":[4,"d",[485,214],55800]},{"":[4,"d",[486,214],55883]},{"":[4,"d",[487,214],55934]},{"":[4,"d",[488,214],55950]},{"":[4,"d",[489,214],55967]},{"":[4,"d",[490,214],55984]},{"":[2,"c",56086]},{"":[5,[178,174],"b",56854]},{"":[4,"d",[178,175],56868]},{"":[4,"d",[179,177],56885]},{"":[4,"d",[180,180],56901]},{"":[4,"d",[182,185],56918]},{"":[4,"d",[182,189],56934]},{"":[4,"d",[182,192],56951]},{"":[4,"d",[182,193],56968]},{"":[4,"d",[182,194],56985]},{"":[4,"d",[182,195],57001]},{"":[4,"d",[182,196],57018]},{"":[4,"d",[182,197],57034]},{"":[2,"c",57134]},{"":[5,[190,195],"b",57326]},{"":[4,"d",[191,195],57335]},{"":[4,"d",[193,195],57351]},{"":[4,"d",[195,195],57372]},{"":[4,"d",[196,195],57389]},{"":[4,"d",[197,195],57406]},{"":[4,"d",[198,195],57423]},{"":[4,"d",[200,195],57451]},{"":[4,"d",[201,195],57468]},{"":[4,"d",[204,194],57485]},{"":[4,"d",[205,192],57502]},{"":[4,"d",[205,191],57518]},{"":[4,"d",[205,190],57535]},{"":[4,"d",[205,189],57551]},{"":[4,"d",[205,187],57568]},{"":[4,"d",[204,185],57585]},{"":[4,"d",[203,182],57602]},{"":[4,"d",[201,180],57623]},{"":[4,"d",[199,179],57640]},{"":[4,"d",[199,178],57736]},{"":[4,"d",[200,178],57752]},{"":[4,"d",[201,178],57769]},{"":[4,"d",[202,178],57785]},{"":[4,"d",[203,178],57802]},{"":[4,"d",[204,178],57819]},{"":[4,"d",[205,179],57835]},{"":[4,"d",[207,180],57852]},{"":[4,"d",[207,181],57869]},{"":[4,"d",[210,184],57885]},{"":[4,"d",[212,186],57902]},{"":[4,"d",[214,188],57935]},{"":[4,"d",[214,189],57969]},{"":[4,"d",[214,190],58002]},{"":[4,"d",[214,191],58019]},{"":[4,"d",[214,192],58035]},{"":[4,"d",[214,194],58052]},{"":[4,"d",[214,194],58085]},{"":[4,"d",[216,195],58269]},{"":[4,"d",[218,196],58285]},{"":[4,"d",[221,198],58302]},{"":[4,"d",[224,199],58319]},{"":[4,"d",[226,199],58352]},{"":[2,"c",58510]}]]}}';

      if (data) {
        // TODO: for testing embed
        data = CJSON.parse(data);

        XB.uniqueID = data["uniqueID"];
        if (XB.uniqueID != uniqueID) {
          alert("Error: The passed in embed code does not match the one stored by the video");
          return;
        }
        XBUI.setMaxTime(data["recordingTime"]);
        XB.recordingTime = data["recordingTime"];
        XB.subtractTime = data["subtractTime"];
        XB.lastEndTime = data["lastEndTime"];
        $.fn.colorPicker.changeColor(data["strokeColor"]);
        XB.events = data["events"];
      } else {
        alert("Error retrieving data.");
      }

    },

    /* Use the video id as a key to retrieve the video data from your
     * datastore of choice.
     *
     * @return: data on success, false on failure.
     * @param id: unique id of video we want to retrieve
     */
    restoreFromDatabase: function(id) {
      // TODO: YOUR IMPLEMENTATION HERE
    },

    /* Generates an 11 character unique ID. */
    genUniqueID: function() {
      var chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZabcdefghiklmnopqrstuvwxyz";
      var len = 11;
      var id = "";
      var rand_no;
      for (var i = 0; i < len; i++){
        rand = Math.floor(Math.random() * chars.length);
        id += chars.substring(rand, rand + 1);
      }
      return id;
    },

    /* Calls XBUI.setClock every XB.sampleRate milliseconds during playback.
     *
     * @param time: the time to set the playbackClock to
     *              if undefined, increment current playbackClock
     *
     */
    setPlaybackClock: function(time){
      if (typeof time === "undefined") {
        XB.playbackClock += XB.sampleRate;
      } else {
        XB.playbackClock = time;
      }

      XBUI.setClock(XB.playbackClock);

      // set timeout if we're in play mode
      if (XB.isPlaying) {
        // to make sure we stop at the end of playback
        if (XB.playbackClock < XB.getRecordingTime()) {
          XB.playbackClockTimeout = setTimeout(XB.setPlaybackClock, XB.sampleRate, XB.playbackClock + XB.sampleRate);
        } else {
          XB.isPlaying = false;
          XB.playbackClock = XB.getRecordingTime();
          XBUI.playPauseToggle();
        }
      }

    },

    /* Gets the time elapsed in recording mode*/
    getRecordingTime: function(){
      if (XB.recording) {
        XB.recordingTime = new Date().getTime() - XB.subtractTime;
      }
      return XB.recordingTime;
    },

    // check if playback is at max time
    playbackEnd: function(){
      return XB.playbackClock == XB.getRecordingTime();
    },

    // check if all events have been played in playback
    eventsEnd: function() {
      return XB.animIndex == (XB.events.length - 1);
    },

    };
})();

;/* xBoard - A Recordable HTML5 Canvas Based Virtual Whiteboard 
 *
 * by Ernie Park, May 2012
 * Under MIT License
 * http://github.com/eipark/xboard
 *
 */

$(document).ready(function(){
  XBUI.init($("canvas"));
});


(function() {

/* Converts ms to MM:SS:ss format */
function readableTime(ms) {
  var x = ms / 1000;
  var seconds = Math.floor(x % 60);
  x /= 60;
  var minutes = Math.floor(x % 60);
  seconds = seconds >= 10 ? seconds : "0" + seconds;
  minutes = minutes >= 10 ? minutes : "" + minutes;
  return minutes + ":" + seconds;
}

/* Returns value of parameter string "query" */
function url_query(query) {
  query = query.replace(/[\[]/,"\\\[").replace(/[\]]/,"\\\]");
  var expr = "[\\?&]"+query+"=([^&#]*)";
  var regex = new RegExp( expr );
  var results = regex.exec( window.location.href );
  if( results !== null ) {
    return results[1];
    return decodeURIComponent(results[1].replace(/\+/g, " "));
  } else {
    return false;
  }
}

window.XBUI = {

  canvasElement: null, // jQuery element for canvas

  wasPlaying: false, // cues whether to continue playback when slider stops
  /**
   * The default ids and classes for the element
   * configurations are the index names used in this
   * array.
   *
   * If names or classes have different names, they
   * should be defined in the script initialization,
   * that is XBUI.init() function.
   *
   * The purpose of this list is only to show what
   * element definitions this scripts uses.
   */
  elementConf: {
    // Classes
    pencil_active:    null,
    eraser_active:    null,

    // Element ids
    button_pencil:    null,
    button_color:   null,
    button_eraser:    null,
    button_animate:   null,
    button_undo:    null,
    input_color:    null,
    button_record: null,
    play_pause: null,
  },

  /**
   * Initializes the XB UI script.
   *
   * @param canvasElement The canvas jQuery element.
   * @param elemconf The element configuration array.
   * This array can contain any of the elements defined
   * in XBUI.elemConf. If the element names differ
   * from the default array indexes, they should be given
   * in this array. Only the differing elements should be
   * defined.
   */
  init: function(canvasElement, elemconf) {
    this.canvasElement = canvasElement;
    $("#xboard-container #slider").slider({});
    XB.init(canvasElement.attr("id"));
    if (elemconf !== undefined) {
      for (var i in this.elementConf) {
        if (elemconf.i !== undefined) {
          this.elementConf.i = elemconf.i;
        }
      }
    }
    this.addListeners();

    // Restore from an embed code if one is passed in
    var embed_code = url_query('embed');
    if (embed_code) {
      XB.restore(embed_code);
    }

    // If in an iframe embed, remove all recording elements.
    if (window != window.top) {
      $(".recording_elt").remove();
    }
  },

  /**
   * Resolves the element name from XBUI.elemConf.
   * If index defined by ind parameter can be found in that
   * array and the array's value is returned. Otherwise
   * the ind parameter itself is returned.
   *
   * @param ind The element's index name in XBUI.elemConf
   * @return The elements correct name
   */
  getElementName: function(ind) {
    if (XBUI.elementConf[ind] === undefined ||
        XBUI.elementConf[ind] === null) {
      return ind;
    }
    return XBUI.elementConf[ind];
  },

  /**
   * Resolves the jQuery element with the defined id which
   * is resolved by XBUI.getElementName function.
   *
   * @param ind The element's index name in XBUI.elemConf
   * or the wanted id name that's not included in that array.
   * @return The jQuery element with the resolved id
   */
  getElement: function(ind) {
    return $('#' + XBUI.getElementName(ind));
  },

  /**
   * Adds all the UI's needed action listeners for buttons
   * and other UI elements.
   */
  addListeners: function() {
    XBUI.getElement('button_pencil').mousedown(function() {
      XBUI.activatePencil();
    });
    XBUI.getElement('button_eraser').mousedown(XBUI.activateEraser);
    XBUI.getElement('button_animate').mousedown(XB.animate);
    XBUI.getElement('recorder').mouseup(XBUI.recordToggle);
    XBUI.getElement('play_pause').mouseup(XBUI.playPauseToggle);
    $("#button_clear").mouseup(XBUI.clear);


    /* XBUI.wasPlaying needed since we always want to be paused before
       jumping around. If wasPlaying, we call XB.play() after the slider
       stops */
    $("#xboard-container #slider").slider({
      start: function(event, ui) {
        if (XB.isPlaying) {
          XBUI.wasPlaying = XB.isPlaying;
          XB.pause();
        }
      }
    });

    $("#xboard-container #slider").slider({
      slide: function(event, ui) {
        // could add tooltips on slide for time updates
      }
    });

    $("#xboard-container #slider").slider({
      stop: function(event, ui) {
        XB.jump(ui.value);
        if (XBUI.wasPlaying) {
          XB.play();
          XBUI.wasPlaying = false;
        }
      }
    });

    // Color Picker
    $("#color_picker").colorPicker({pickerDefault: "000000"});
    $(".colorPicker-swatch").click(function(){
      XB.setStrokeStyle($(this).css("background-color"));
    });

  },

  /* Toggles a class and calls a function for both cases when the class
     is there and not there. Small wrapper, for record and play button. */
  toggler: function(elt, toggle_class, truth_func, false_func) {
    if (elt.hasClass(toggle_class)){
      elt.removeClass(toggle_class);
      truth_func();
    } else {
      elt.addClass(toggle_class);
      false_func();
    }
  },

  playPauseToggle: function() {
    XBUI.toggler($("#play_pause"), "is_playing", XBUI.pause, XBUI.play);
  },

  recordToggle: function() {
    XBUI.toggler($("#recorder"), "is_recording", XBUI.pauseRecord, XBUI.record);
  },

  /* Changes recording button and disables buttons not appropriate
     for recording state. */
  record: function(elt) {
    $("#slider").slider("disable");
    $("#drawsection").addClass("is_recording");
    $("button#play_pause").attr("disabled", true);
    $("#recorder").attr("title", "Stop Recording");
    XB.record();
  },

  pauseRecord: function() {
    $("button#play_pause").attr("disabled", false);
    $("#slider").slider("enable");
    $("#drawsection").removeClass("is_recording");
    $("#recorder").attr("title", "Record");
    XB.pauseRecord();
  },

  play: function() {
    $("#recorder").attr("disabled", true);
    XB.play();
  },

  pause: function() {
    $("#recorder").attr("disabled", false);
    XB.pause();
  },

  /**
   * Resolves the X coordinate of the given event inside
   * the canvas element.
   *
   * @param event The event that has been executed.
   * @return The x coordinate of the event inside the
   * canvas element.
   */
  getX: function(event) {
    var cssx = (event.clientX - this.canvasElement.offset().left);
      var xrel = XB.getRelative().width;
      var canvasx = cssx * xrel;
      return canvasx;
  },

  /**
   * Resolves the Y coordinate of the given event inside
   * the canvas element.
   *
   * @param event The event that has been executed.
   * @return The y coordinate of the event inside the
   * canvas element.
   */
  getY: function(event) {
      var cssy = (event.clientY - this.canvasElement.offset().top);
      var yrel = XB.getRelative().height;
      var canvasy = cssy * yrel;
      return canvasy;
  },

  /**
   * Returns the canvas element to its default definition
   * without any extra classes defined by any of the selected
   * UI tools.
   */
  changeTool: function() {
    XBUI.canvasElement.unbind();
    XBUI.canvasElement.removeClass(XBUI.getElementName('pencil_active'));
    XBUI.canvasElement.removeClass(XBUI.getElementName('eraser_active'));
    $("div#tools input").removeClass("active");
  },

  /**
   * Activates pencil tool and adds pencil_active class
   * to canvas element.
   *
   * @param event The event that has been executed to perform
   * this action
   */
  activatePencil: function(event) {
    XBUI.changeTool();
    XBUI.canvasElement.bind("mousedown", XBUI.beginPencilDraw);
    XBUI.canvasElement.addClass(XBUI.getElementName('pencil_active'));
    $("#button_pencil").addClass("active");
  },

  /**
   * Begins the pencil draw after user action that is usually
   * mouse down. This should be executed on mousedown event
   * after activating the pen tool.
   *
   * @param event The event that has been executed to perform
   * this action
   */
  beginPencilDraw: function(event) {
      XB.canvasFunction("beginPencilDraw", XBUI.getX(event), XBUI.getY(event));
      XBUI.canvasElement.bind("mousemove", function(event) {
          XB.canvasFunction("pencilDraw", XBUI.getX(event), XBUI.getY(event));
      });
      XBUI.canvasElement.bind("mouseup", XBUI.endPencilDraw);
      XBUI.canvasElement.bind("mouseout", XBUI.endPencilDraw);
  },

  /**
   * Ends pencil draw which means that mouse moving won't
   * be registered as drawing action anymore. This should be
   * executed on mouseup after user has started drawing.
   *
   * @param event The event that has been executed to perform
   * this action
   */
  endPencilDraw: function (event) {
    XB.canvasFunction("endPencilDraw");
    XBUI.canvasElement.unbind("mousemove");
    XBUI.canvasElement.unbind("mouseup");
    XBUI.canvasElement.unbind("mouseout");
  },

  /**
   * Activates erasing tool and adds eraser_active class
   * to canvas element.
   *
   * @param event The event that has been executed to perform
   * this action
   */
  activateEraser: function(event) {
    XBUI.changeTool();
    XBUI.canvasElement.bind("mousedown", XBUI.beginErasing);
    XBUI.canvasElement.addClass(XBUI.getElementName('eraser_active'));
    $("#button_eraser").addClass("active");
  },

  /**
   * Begins the erasing action after user action that is usually
   * mouse down. This should be executed on mousedown event
   * after activating the erasing tool.
   *
   * @param event The event that has been executed to perform
   * this action
   */
  beginErasing: function(event) {
      XB.canvasFunction("beginErasing", XBUI.getX(event), XBUI.getY(event));
      XBUI.canvasElement.bind("mousemove", function(event) {
          XB.canvasFunction("erasePoint", XBUI.getX(event), XBUI.getY(event));
      });
      XBUI.canvasElement.bind("mouseup", XBUI.endErasing);
      XBUI.canvasElement.bind("mouseout", XBUI.endErasing);
  },

  /**
   * Ends erasing which means that mouse moving won't
   * be registered as erasing action anymore. This should be
   * executed on mouseup after user has started erasing.
   *
   * @param event The event that has been executed to perform
   * this action
   */
  endErasing: function(event) {
    XBUI.canvasElement.unbind("mousemove");
    XBUI.canvasElement.unbind("mouseup");
    XBUI.canvasElement.unbind("mouseout");
  },

  clear: function() {
    XB.canvasFunction("clear");
  },

  /* Updates the total recording time and playback time clocks in the UI */
  setClock: function(time){
    // if time is passed in, we use it, otherwise we just set it to
    // the current recording time because it means we are recording
    // and the total time is increasing
    if (typeof time === "undefined"){ // implies we are recording, so we update the max
      time = XB.getRecordingTime();
      $("#xboard-container #slider").slider("option", "max", time);
    } else if (time > XB.getRecordingTime()) {
      // since this time is set by an incrementer, the last one will exceed
      // our recording time so we set it back down and stop the timeout
      // since we've reached the end of playback
      time = XB.getRecordingTime();
    }
    // set clocks in UI, elapsed/total
    $("#elapsed_timer").html(readableTime(time));
    // want XB.getRecordingTime() since on playback recordingtime stays same
    $("#total_timer").html(readableTime(XB.getRecordingTime()));

    // set slider position
    $("#xboard-container #slider").slider("option", "value", time);
  },

  /* Wrapper for setClock that allows an interval to be set
     using setTimeout instead of setInterval. Prevents "blocking" */
  setClockInterval: function() {
    XBUI.setClock();
    XB.recordClockInterval = setTimeout(XBUI.setClockInterval, XB.sampleRate);
  },

  /* Set the max time for the slider and UI */
  setMaxTime: function(time){
    $("#xboard-container #slider").slider("option", "max", time);
    $("#total_timer").html(readableTime(time));
  }

};
})();

;
//# sourceMappingURL=app.js.map