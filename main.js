// Pixel Anarchy

var level = require('level-browserify');

(function(){


// Message UI.

var msgTimer = null;
var msgFade = 1.0;
function showMsg(msg, time) {
  var text = document.getElementById("msgline");
  var div = document.getElementById("msg");
  if (div && text) {
    text.innerHTML = msg;
    div.style.display = "block";
    div.style.opacity = 1.0;
    msgFade = 1.0;
    if (msgTimer) window.clearTimeout(msgTimer);
    msgTimer = window.setTimeout(fadeMsg, time || 3000);
  }
}
function fadeMsg() {
  msgTimer = null;
  var div = document.getElementById("msg");
  if (div) {
    msgFade -= 0.1;
    if (msgFade > 0) {
      div.style.opacity = msgFade;
      msgTimer = window.setTimeout(fadeMsg, 50);
    } else {
      div.style.display = "none";
    }
  }
}


// Local DB.

var db = level('./mydb');
var pending = false;
var saving = false;
var loaded = false;

var myLayer = {
  id: null,
  token: null,
  gridTop: 0,
  grid: [[0,0]]
};

function load() {
  db.get('local', function (err, value) {
    if (err && err.name != "NotFoundError") {
      showMsg("Could not restore your pixels!");
      return console.log('Could not restore:', err);
    }
    if (value) {
      myLayer = JSON.parse(value);
      // fix hack.
      delete myLayer.myId;
      delete myLayer.myToken;
      if (myLayer.id === "--") {
        myLayer.id = null;
        myLayer.token = null;
      }
    }
    if (!myLayer.grid) myLayer.grid = [[0,0]];
    if (typeof(myLayer.gridTop) != 'number') myLayer.gridTop = 0;
    loaded = true;
    render();
    doSync();
  });
}
function dirty() {
  if (!pending) {
    console.log("Dirty.");
    pending = true;
    needPush = true;
    window.setTimeout(saveNow, 2000);
  }
}
function saveNow(cb) {
  if (loaded && myLayer.grid) {
    console.log("Saving now.");
    pending = false;
    saving = true;
    var data = JSON.stringify(myLayer);
    db.put('local', data, function (err) {
      if (err) {
        showMsg("Could not save your pixels!");
        return console.log('Could not save:', err);
      }
      saving = false;
      if (needPush) pushLayer();
      if (cb) cb();
    });
  }
}



// SockJS.

var sock;
var sockOps = {};
var backoff = 10000;
var needPush = true;
var pushing = false;
function send(data) {
  if (sock) {
    sock.send(JSON.stringify(data));
  }
}

function doSync() {
  if (!window.SockJS) {
    return console.log("Missing SockJS");
  }
  console.log("Starting sync: ", window.location.host);
  sock = new SockJS('http://'+window.location.host+'/socket');
  sock.onopen = function() {
    console.log('SockJS open');

    showMsg("Synchronizing...", 60000);

    var backoff = 10000;
    document.getElementById('status').innerHTML = "ONLINE";
    document.getElementById('status').style.color = "#209020";
    // obtain a unique ID for this device if we don't have one.
    if (!myLayer.id) {
      // no ID, start by getting one.
      console.log("Requesting an ID.");
      send({ op: 'getID' });
    } else {
      // have an id, so now try to push our layer.
      console.log("Have an ID: "+myLayer.id);
      pullIndex();
    }
  };
  sock.onmessage = function(e) {
    console.log('SockJS message', e.data);
    var msg = JSON.parse(e.data);
    var fun = sockOps[msg.op];
    if (fun) fun(msg);
  };
  sock.onclose = function() {
    console.log('SockJS close');
    sock = null;
    document.getElementById('status').innerHTML = "OFFLINE";
    document.getElementById('status').style.color = "#902020";
    backoff = Math.floor(backoff * 1.3);
    if (backoff > 300000) backoff = 300000;
    window.setTimeout(doSync, backoff);
    showMsg("Offline!", 1000);
  };
}

sockOps['assignID'] = function (data) {
  if (myLayer.id) return;
  if (data && data.id && data.token) {
    console.log("Received ID:", data.id);
    myLayer.id = data.id;
    myLayer.token = data.token;
    pullIndex();
    // autosave the ID and push the layer.
    dirty();
  } else {
    console.log("Error getting an ID:", data);
  }
};

function pushLayer() {
  if (loaded && myLayer.id && myLayer.grid) {
    console.log("Pushing now.");
    needPush = false;
    pushing = true;
    send({
      op: 'pushLayer',
      id: myLayer.id,
      token: myLayer.token,
      gridTop: myLayer.gridTop,
      grid: myLayer.grid
    });
  }
}

sockOps['didPush'] = function (data) {
  if (data && data.error) {
    console.log("Error pushing layer: "+data.error);
    showMsg("Cannot upload your pixels!", 5000, true);
    return;
  }
  console.log("Did push layer.");
  pushing = false;
  if (needPush) pushLayer();
};

function pullIndex() {
  // Pull down the current layer index, which contains the layer ids
  // and their current version numbers and priority order.
  console.log("Requesting layer index.");
  send({ op: 'getIndex' });
}

var layers = [];
function sortLayers() {
  layers.sort(function(a,b){
    var ad = a.depth || 0;
    var bd = b.depth || 0;
    var ats = a.ts || 0;
    var bts = b.ts || 0;
    if (ad === bd) {
      // same depth, sort on timestamp.
      if (ats === bts) {
        // same timestamp, sort on ID.
        return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
      } else {
        return ats < bts ? -1 : (ats > bts ? 1 : 0);
      }
    } else {
      // sort on depth.
      return ad < bd ? -1 : (ad > bd ? 1 : 0);
    }
  });
}
sockOps['index'] = function (data) {
  console.log("Received index:", data);
  // before replacing the layer index, grab all the layers we have already loaded.
  var existing = {};
  for (var i=0; i<layers.length; i++) {
    var layer = layers[i];
    if (layer.id && layer.ver && layer.grid) {
      existing[layer.id] = layer;
    }
  }
  // replace the layer index.
  layers = data.layers || [];
  if (typeof layers.length !== 'number') layers = [];
  // restore the loaded data for existing layers.
  var foundMe = false;
  for (var i=0; i<layers.length; i++) {
    var layer = layers[i];
    if (layer.id === myLayer.id && myLayer.id) {
      // found the local layer; attach our local data.
      layers[i] = myLayer;
      foundMe = true;
    } else if (layer.id && layer.ver && existing.hasOwnProperty(layer.id)) {
      // found a layer we already have loaded.
      // check if the layer version has changed (we need to download it again)
      var old = existing[layer.id];
      if (old && old.id === layer.id && old.ver === layer.ver && old.grid) {
        layer.grid = old.grid;
        layer.gridTop = old.gridTop;
      }
    }
  }
  if (!foundMe) {
    layers.push(myLayer);
  }
  // sort layers for rendering.
  sortLayers();
  pullDownLayers();
};

var pullTimer = null;

function pullDownLayers() {
  if (!pullTimer && sock) {
    pullTimer = window.setTimeout(loadNextLayer, 100);
  }
}

function loadNextLayer() {
  pullTimer = null;
  // start loading the next layer.
  for (var i=0; i<layers.length; i++) {
    var layer = layers[i];
    if (layer.id && layer.id !== myLayer.id && !layer.grid) {
      // load this layer.
      loadLayer(layer.id, layer, function (err) {
        if (err) console.log("Error loading layer:", layer.id, err);
        if (!pullTimer && sock) {
          pullTimer = window.setTimeout(loadNextLayer, 100);
        }
        render();
      });
      return;
    }
  }
  showMsg("Ready!", 1000);
  if (needPush) pushLayer();
}

var gettingLayer = null;
var gettingCB = null;
function loadLayer(id, layer, cb) {
  // check if we have a local copy of this layer.
  console.log("Loading layer:", id);
  db.get(layer.id, function (err, value) {
    if (err && err.name != "NotFoundError") {
      return cb(err);
    }
    if (value) {
      try {
        var obj = JSON.parse(value);
      } catch (err) {
        return cb(err);
      }
      if (obj && obj.grid && obj.gridTop != null && obj.ver != null && obj.ver === layer.ver) {
        // our local copy is the same as the server copy.
        console.log("Already up to date:", id);
        layer.gridTop = obj.gridTop;
        layer.grid = obj.grid;
        return cb(null);
      }
    }
    // the server version differs, or we don't have a local copy yet.
    console.log("Downloading layer:", id);
    gettingLayer = layer;
    gettingCB = cb;
    send({
      op: 'loadLayer',
      id: layer.id
    });
    // NO cb() here, wait for getLayer response.
  });
}

sockOps['didLoad'] = function (data) {
  // Receive the response to the last getLayer request.
  console.log("Received layer download:", data.id, data.error);
  if (gettingLayer && gettingCB) {
    var err = null;
    if (data.ver && data.ver > 0 && data.grid && data.gridTop != null && data.id != myLayer.id) {
      gettingLayer.ver = data.ver;
      gettingLayer.gridTop = data.gridTop;
      gettingLayer.grid = data.grid;
    } else {
      err = data.error || "invalid layer data";
    }
    gettingLayer = null;
    var cb = gettingCB;
    gettingCB = null;
    cb(err);
  }
};


// Drawing canvas.

var canvas = document.getElementById('c');
var width, height;
var orgX = 0, orgY = 0; // center
var zoom = 6;
var pan = false;
function resize() {
  width = window.innerWidth || (document.documentElement ? document.documentElement.offsetWidth : document.body.offsetWidth);
  height = window.innerHeight || (document.documentElement ? document.documentElement.offsetHeight : document.body.offsetHeight);
  canvas.width = width;
  canvas.height = height;
  render();
}

var panHeld = false;
var panMode = false;
var painting = false;
var lastX = 0, lastY = 0;
var pen = 1, lastPen = 1;
var panning = false;
var panOrgX = 0, panOrgY = 0;
function mouseDown(e) {
  var e = e || window.event;
  if (panHeld || panMode) {
    panning = true;
    painting = false;
    panOrgX = e.clientX;
    panOrgY = e.clientY;
    return;
  }
  painting = true;
  panning = false;
  if (e.button === 0) val = 1; else val = 0;
  // map screen space to view space.
  var ptX = -width/2 + e.clientX;
  var ptY = -height/2 + e.clientY;
  // map view space to cell coordinates.
  var cx = Math.floor((orgX + ptX) / zoom);
  var cy = Math.floor((orgY + ptY) / zoom);
  line(lastX, lastY, cx, cy, pen);
  lastX = cx;
  lastY = cy;
  render();
  if (e.preventDefault) {
    e.preventDefault();
    e.stopPropagation();
    e.cancelBubble = true;
  }
}
function mouseMove(e) {
  var e = e || window.event;
  if (panHeld || panMode) {
    if (panning) {
      orgX -= (e.clientX - panOrgX);
      orgY -= (e.clientY - panOrgY);
      panOrgX = e.clientX;
      panOrgY = e.clientY;
      render();
    } else if (panHeld) {
      panOrgX = e.clientX;
      panOrgY = e.clientY;
      panning = true;
    }
  } else {
    panning = false;
    if (painting) {
      // map screen space to view space.
      var ptX = -width/2 + e.clientX;
      var ptY = -height/2 + e.clientY;
      // map view space to cell coordinates.
      var cx = Math.floor((orgX + ptX) / zoom);
      var cy = Math.floor((orgY + ptY) / zoom);
      line(lastX, lastY, cx, cy, pen);
      lastX = cx;
      lastY = cy;
      render();
    }
  }
}
function mouseUp(e) {
  var e = e || window.event;
  painting = false;
  panning = false;
  if (e.preventDefault) {
    e.preventDefault();
    e.stopPropagation();
    e.cancelBubble = true;
  }
}

function line(x0,y0,x1,y1,val) {
  point(x1, y1, val);
  return;
  var dx = Math.abs(x1-x0);
  var dy = Math.abs(y1-y0);
  if (dx > dy) {
    // X major
    if (y1 > y0) {
      // ascending
    }
  } else {
    // Y major
  }
}

function point(x, y, val) {
  if (!loaded) return;
  var top = myLayer.gridTop;
  var grid = myLayer.grid;
  x = Math.floor(x);
  y = Math.floor(y);
  while (y < top) {
    // add a line at the top of the grid (top-down)
    grid.unshift([0,0]);
    top -= 1;
  }
  myLayer.gridTop = top;
  // move Y into grid space
  y -= top;
  while (y >= grid.length) {
    // add a line at the bottom of the grid (top-down)
    grid.push([0,0]);
  }
  var row = grid[y];
  if (!(row && row.length)) return;
  while (x < row[0]) {
    // extend the row to the left.
    row.splice(1, 0, 0);
    row[0] -= 1;
  }
  // move X into grid space
  x -= row[0];
  if (x >= 0) {
    row[x+1] = val; // advance past row origin at index zero
  }
  // autosave
  dirty();
}

window.document.body.addEventListener("mousedown", mouseDown, false);
window.document.body.addEventListener("mousemove", mouseMove, false);
window.document.body.addEventListener("mouseup", mouseUp, false);

function touchStart(e) {
  if (e.touches && e.touches[0]) {
    mouseDown({
      clientX: e.touches[0].clientX,
      clientY: e.touches[0].clientY
    });
  }
}
function touchMove(e) {
  if (e.touches && e.touches[0]) {
    mouseMove({
      clientX: e.touches[0].clientX,
      clientY: e.touches[0].clientY
    });
  }
}
function touchEnd(e) {
  if (!(e.touches && e.touches[0])) {
    mouseUp({});
  }
}
window.document.body.addEventListener("touchstart", touchStart, false);
window.document.body.addEventListener("touchmove", touchMove, false);
window.document.body.addEventListener("touchend", touchEnd, false);

function onKeyDown(e) {
  var e = e || window.event;
  if (e.keyCode == 27) {
    // Prevent ESC in Firefox < 20 closing the socket.
    e.preventDefault();
  }
  if (e.keyCode == 32 || e.which == 32) {
    panHeld = true;
    canvas.style.cursor = "grab";
    if (canvas.style.cursor != "grab") canvas.style.cursor = "all-scroll";
    if (canvas.style.cursor != "all-scroll") canvas.style.cursor = "move";
    e.preventDefault();
    e.stopPropagation();
    e.cancelBubble = true;
  }
}

function onKeyUp(e) {
  var e = e || window.event;
  if (e.keyCode == 32 || e.which == 32) {
    panHeld = false;
    canvas.style.cursor = "crosshair";
    e.preventDefault();
    e.stopPropagation();
    e.cancelBubble = true;
  }
}

function onWheel(e) {
  var dy = e.deltaY;
  if (e.deltaMode == 1) dy = dy/10;
  else if (e.deltaMode == 2) dy = dy/100;
  if (dy > 0) dy=1;
  if (dy < 0) dy=-1;
  if (dy) zoom -= dy;
  if (zoom <= 0) zoom = 1;
  if (e.preventDefault) e.preventDefault();
  render();
}

canvas.style.cursor = "crosshair";

window.addEventListener('keydown', onKeyDown, false);
window.addEventListener('keyup', onKeyUp, false);
window.addEventListener('wheel', onWheel, false);



var palette = [
  "#000000",
  "#4F5786",
  "#7789A1",
  "#C4D0BA",
  "#E9EBC3",
  "#E8DEA9",
  "#C2AF8F",
  "#937774"
];

function renderPalette() {
  var sw = 40;
  var sp = 2;
  var c = document.getElementById("pal");
  c.width = sw+4;
  c.height = (sp+sw)*(palette.length-1)-sp+4;
  var g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  if (pen > 0) {
    y = (pen-1) * (sw+sp);
    g.fillStyle = "#fff";
    g.fillRect(0, y, sw+4, sw+4);
  }
  var y = 2;
  for (var i=1; i<palette.length; i++) {
    g.fillStyle = palette[i];
    g.fillRect(2, y, sw, sw);
    y += sw + sp;
  }
}

function clickPal(e) {
  var sw = 40;
  var sp = 6;
  var i = Math.floor(e.clientY / (sp+sw));
  if (i >= 0 && i < palette.length) {
    pen = 1 + i;
    lastPen = pen;
    renderPalette();
  }
}

function bind(id, msg, func) {
  function clicked(e) {
    func(e);
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    e.cancelBubble = true;
  }
  var el = document.getElementById(id);
  el.addEventListener(msg, clicked, false);
  el = null;
}
function hide(id) {
  var el = document.getElementById(id);
  el.style.display = 'none';
}
function show(id) {
  var el = document.getElementById(id);
  el.style.display = '';
}

bind("pal", "mousedown", clickPal);

bind("draw", "mousedown", function(){
  panMode = false;
  pen = lastPen;
  show("palette");
  renderPalette();
});
bind("erase", "mousedown", function(){
  panMode = false;
  if (pen) lastPen = pen;
  pen = 0;
  hide("palette");
});
bind("move", "mousedown", function(){
  if (pen) lastPen = pen;
  pen = 0;
  hide("palette");
  panMode = true;
});

var ctx = canvas.getContext('2d');

function render() {
  //ctx.fillStyle = "rgba(0,0,0,255)";
  //ctx.fillRect(0, 0, width, height);
  ctx.clearRect(0, 0, width, height);

  // top,left edge of screen in view space.
  var ptX = -width/2;
  var ptY = -height/2;

  // top,left visible cell in cell coordinates.
  var leftCell = Math.floor((orgX + ptX) / zoom);
  var topCell = Math.floor((orgY + ptY) / zoom);

  // map top,left of top,left cell to view space.
  var viewX = (leftCell * zoom - orgX);
  var viewY = (topCell * zoom - orgY);

  // map view space to screen space.
  viewX -= ptX;
  viewY -= ptY;

  // number of visible cells in view space.
  var cellsX = Math.ceil((width + zoom - 1) / zoom);
  var cellsY = Math.ceil((height + zoom - 1) / zoom);

  for (var j=0; j<layers.length; j++) {
    var grid = layers[j].grid;
    var gridTop = layers[j].gridTop;
    if (grid && gridTop != null) {
      // render pixels.
      var rowY = viewY;
      for (var y=0; y<cellsY; y++) {
        var rowX = viewX;
        var row = grid[topCell + y - gridTop];
        if (row && row.length) {
          var rowLeft = row[0]; // row origin at index zero.
          var i = leftCell - rowLeft;
          for (var x=0; x<cellsX; x++) {
            if (i >= 0) {
              var col = row[i+1] || 0; // +1 to skip over row origin.
              if (col) {
                ctx.fillStyle = palette[col];
                ctx.fillRect(rowX, rowY, zoom, zoom);
              }
            }
            rowX += zoom;
            i += 1;
          }
        }
        rowY += zoom;
      }
    }
  }

  // grid lines.
  if (1) {
    var per = 0.5;
    if (zoom < 6) {
      per = 1 - (1/zoom*2);
    }
    ctx.strokeStyle = "rgba(200,200,198,"+per+")";
    ctx.beginPath();
    for (var y=0; y<cellsY; y++) {
      var p = viewY + y * zoom;
      ctx.moveTo(0, p);
      ctx.lineTo(width, p);
    }
    for (var x=0; x<cellsX; x++) {
      var p = viewX + x * zoom;
      ctx.moveTo(p, 0);
      ctx.lineTo(p, height);
    }
    ctx.stroke();
    ctx.beginPath();
  }
}

window.onresize = resize;
resize();
renderPalette();
window.setTimeout(load, 0);


})();
