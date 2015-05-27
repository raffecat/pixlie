// Pixel Anarchy

var level = require('level-browserify');

(function(){

// 1) Create our database, supply location and options.
//    This will create or open the underlying LevelDB store/Indexedb Database
var db = level('./mydb');

var gridTop = 0;
var grid = null;
var myId = null;

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
    if (msgTimer) window.cancelTimeout(msgTimer);
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

function load() {
  db.get('local', function (err, value) {
    if (err) {
      showMsg("Could not restore your pixels!");
      return console.log('Could not restore:', err);
    }
    if (value && !err) {
      obj = JSON.parse(value);
      if (obj && obj.grid) {
        gridTop = obj.gridTop;
        grid = obj.grid;
        myId = obj.myId;
      }
    }
    if (!grid) {
      gridTop = 0;
      grid = [[0,0]];
      myId = null;
    }
    if (typeof(gridTop) != 'number') gridTop = 0;
    render();
    showMsg("Ready!", 1000);
    doSync();
  });
}

var sock;
var sockOps = {};
var backoff = 10000;
var needPush = true;
var pushing = false;
function send(data) {
  sock.send(JSON.stringify(data));
}

function doSync() {
  if (!window.SockJS) {
    return console.log("Missing SockJS");
  }

  console.log("Starting sync: ", window.location.host);
  sock = new SockJS('http://'+window.location.host+'/socket');
  sock.onopen = function() {
    console.log('SockJS open');
    var backoff = 10000;
    document.getElementById('status').innerHTML = "ONLINE";
    // obtain a unique ID for this device if we don't have one.
    if (!myId) {
      // no ID, start by getting one.
      console.log("Requesting an ID.");
      send({ op: 'getID' });
    } else {
      // have an id, so now try to push our layer.
      console.log("Have an ID: "+myId);
      pushLayer();
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
    document.getElementById('status').innerHTML = "OFFLINE";
    backoff = Math.floor(backoff * 1.3);
    if (backoff > 300000) backoff = 300000;
    window.setTimeout(doSync, backoff);
  };
}

sockOps['assignID'] = function (data) {
  console.log("Received an ID", data);
  if (data && data.id && !myId) {
    myId = data.id;
    // autosave the ID and push the layer.
    dirty();
  }
};

sockOps['didPush'] = function (data) {
  console.log("Did push layer.");
  pushing = false;
  if (needPush) pushLayer();
};

var pending = false;
var saving = false;
function dirty() {
  if (!pending) {
    console.log("Dirty.");
    pending = true;
    needPush = true;
    window.setTimeout(saveNow, 2000);
  }
}
function saveNow(cb) {
  console.log("Saving now.");
  pending = false;
  saving = true;
  var obj = {
    gridTop: gridTop,
    grid: grid,
    myId: myId
  };
  var data = JSON.stringify(obj);
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

function pushLayer() {
  console.log("Pushing now.");
  needPush = false;
  pushing = true;
  send({
    op: 'pushLayer',
    id: myId,
    gridTop: gridTop,
    grid: grid
  });
}

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
  if (!grid) return;
  x = Math.floor(x);
  y = Math.floor(y);
  while (y < gridTop) {
    // add a line at the top of the grid (top-down)
    grid.unshift([0,0]);
    gridTop -= 1;
  }
  // move Y into grid space
  y -= gridTop;
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
  el.addEventListener(msg, clicked);
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

  if (!grid) return;

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
