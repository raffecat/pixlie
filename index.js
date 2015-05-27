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

  app.use(express.static('static'));

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
      var id = uid(30);
      var token = uid(60);
      console.log("New ID:", id);
      var doc = {_id:id, token:token, ver:0, ts:Date.now()};
      layers.insert(doc, function (err, res) {
        if (err) {
          console.log("Cannot insert ID:", id, err);
          return send({ op: "assignID", error: true });
        }
        if (res && res.writeError) {
          console.log("Cannot insert ID:", id, res.writeError);
          return send({ op: "assignID", error: true });
        }
        return send({ op: "assignID", id: id, token: token });
      });
    };

    // the client will send this to load the layer index.
    sockOps['getIndex'] = function (data) {
      layers.find({ ver:{$gt:0} }).toArray(function(err, res) {
        if (err) {
          console.log("Cannot list layer index.", err);
          return send({ op: "index", error: true });
        }
        res = res.map(function(doc){
          return {
            id: doc._id,
            ver: doc.ver,
            ts: doc.ts,
            depth: doc.depth
          };
        });
        return send({ op: "index", layers: res });
      });
    };

    // the client will send this when it has changes to upload.
    sockOps['pushLayer'] = function (data) {
      if (data && data.id && data.token && data.grid && data.gridTop != null) {
        // validate layer id and token.
        var id = data.id;
        layers.findOne({ _id: id, token: data.token }, function (err, obj) {
          if (err) return console.log(err);
          if (obj) {
            // correct id and token; save the new layer version.
            var fields = {
              ver: (obj.ver||0) + 1,
              grid: data.grid,
              gridTop: data.gridTop
            };
            layerData.update({_id:id}, {$set:fields}, {upsert:true}, function (err) {
              if (err) {
                console.log("Cannot upsert:", id, err);
                return send({ op: "didPush", error: true });
              }
              console.log("Saved layer:", id);
              return send({ op: "didPush", saved: true });
            });
          } else {
            console.log("Did not find layer.");
            return send({ op: "didPush", error: true });
          }
        });
      } else {
        console.log("Bad push data:", data && data.id);
        return send({ op: "didPush", error: true });
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
  server.listen(80);

  //db.close();
});


