var express = require('express');
var uid = require('uid2');

var MongoClient = require('mongodb').MongoClient;
var ObjectID = require('mongodb').ObjectID;

var app = express();
var server = require('http').Server(app);
var io = require('socket.io')(server);

var url = 'mongodb://localhost:27017/pixlie';
MongoClient.connect(url, function(err, db) {
  if (err) throw err;
  console.log("Connected to mongodb.");

  var layers = db.collection("layers");
  var layerData = db.collection("layerdata");

  function assignID(cb) {
    var id = uid();
    var doc = {_id:id, version:0};
    layers.insert(doc, function (err, res) {
      if (err) return cb(err);
      if (res) return cb(new Error("conflict"));
      return cb(null, doc._id.toString());
    });
  }

  function loadIndex(req, res) {
    layers.find({}).toArray(function(err, res) {
      if (err) return res.send(500, "error");
      return res.json({layers:res});
    });
  }

  app.use(express.static('.'));
  server.listen(9966);

  app.get('/', function (req, res) {
    res.sendfile(__dirname + '/index.html');
  });

  io.on('connection', function (socket) {
    socket.emit('sync', {});

    socket.on('getID', function (data) {
      console.log("getID", data);
      assignID(function (err, id) {
        if (err) return console.log(err);
        if (id) socket.emit("assignID", {id:id});
      });
    });

    socket.on('pushLayer', function (data) {
      console.log("pushLayer", data);
      if (data && data.id && data.grid && data.gridTop != null) {
        // validate layer id.
        layers.findOne({_id:data.id}, function (err, obj) {
          if (err) return console.log(err);
          if (obj) {
            // valid id, accept the layer data.
            layerData.update({_id:obj.id}, obj, {upsert:true}, function (err) {
              if (err) console.log(err);
            });
          }
        });
      }
    });

  });

  //db.close();
});


