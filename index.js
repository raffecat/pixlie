var uuid = require('uuid2');
var mongodb = require('mongodb');
var ObjectID = mongodb.ObjectID;

var layers = db.collection("layers");
var layerData = db.collection("layerdata");

function assignID(req, res) {
  var id = uuid();
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

var express = require('express');

var app = express();

app.use(express.static('index.html'));
app.use(express.static('bundle.js'));
app.use(express.static('tools.png'));
app.listen(8000);
