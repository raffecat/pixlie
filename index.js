var uid = require('uid2');

var MongoClient = require('mongodb').MongoClient;
var ObjectID = require('mongodb').ObjectID;

var app = require('express')();
var server = require('http').Server(app);
var io = require('socket.io')(server);

var url = 'mongodb://localhost:27017/pixlie';
MongoClient.connect(url, function(err, db) {
  if (err) throw err;
  console.log("Connected to mongodb.");

  var layers = db.collection("layers");
  var layerData = db.collection("layerdata");

  function assignID(req, res) {
    var id = uid();
    var doc = {_id:id, version:0};
    layers.insert(doc, function (err, res) {
      if (err) return res.send(500, "error");
      if (res) return res.send(500, "ID conflict");
      return res.json(doc);
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

  //db.close();
});


