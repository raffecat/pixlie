var express = require('express');
var sockjs = require('sockjs');
var uid = require('uid2');

var MongoClient = require('mongodb').MongoClient;
var ObjectID = require('mongodb').ObjectID;

var app = express();
var server = require('http').Server(app);

var url = 'mongodb://localhost:27017/pixlie';
MongoClient.connect(url, function(err, db) {
  if (err) throw err;
  console.log("Connected to mongodb.");

  var layers = db.collection("layers");
  var layerData = db.collection("layerdata");

  function assignID(cb) {
    var id = uid(30);
    console.log("new Id:", id);
    var doc = {_id:id, ver:0};
    layers.insert(doc, function (err, res) {
      if (err) return cb(err);
      if (res && res.writeError) return cb(new Error("Conflict: "+res.writeError));
      return cb(null, doc._id.toString());
    });
  }

  function loadIndex(cb) {
    layers.find({}).toArray(function(err, res) {
      if (err) return cb(new Error("Cannot list layer index."));
      res = res.map(function(doc){
        return { id: doc._id.toString(), ver: doc.ver||0 };
      });
      cb(null, res);
    });
  }

  app.use(express.static('.'));

  app.get('/', function (req, res) {
    res.sendfile(__dirname + '/index.html');
  });

  var sockServ = sockjs.createServer({
    sockjs_url: 'http://cdn.jsdelivr.net/sockjs/1.0.0/sockjs.min.js',
    prefix: '/socket'
  });

  sockServ.on('connection', function(conn) {
    console.log("SockJS connection");

    function send(data) {
      if (conn.writable) {
        conn.write(JSON.stringify(data));
      }
    }

    var sockOps = {};

    // the client will send this if it needs an id for the device.
    sockOps['getID'] = function (data) {
      console.log("getID", data);
      assignID(function (err, id) {
        if (err) return console.log(err);
        if (id) send({ op: "assignID", id: id });
      });
    };

    // the client will send this when it has changes to upload.
    sockOps['pushLayer'] = function (data) {
      if (data) {
        console.log("pushLayer", data.id, data.gridTop, data.grid && data.grid.length);
      }
      if (data && data.id && data.grid && data.gridTop != null) {
        // validate layer id.
        var saveId = data.id;
        delete data.id;
        layers.findOne({_id:saveId}, function (err, obj) {
          if (err) return console.log(err);
          if (obj) {
            // valid id, accept the layer data.
            layerData.update({_id:saveId}, data, {upsert:true}, function (err) {
              if (err) return console.log(err);
              console.log("Saved layer data.");
              send({ op: "didPush" });
            });
          } else {
            console.log("Did not find layer.");
          }
        });
      } else {
        console.log("Bad push data.");
      }
    };

    conn.on('data', function(message) {
      var msg = JSON.parse(message);
      //conn.write(message);
      console.log("SockJS data", Object.keys(msg));
      var fun = sockOps[msg.op];
      if (fun) { fun(msg); }
      else console.log("Bad message:", msg);
    });

    conn.on('close', function() {
      console.log("SockJS close");
    });

  });

  sockServ.installHandlers(server);
  server.listen(9966);

  //db.close();
});


