
var airswarm        = require('airswarm');
var fs              = require('fs');
var debug           = require('debug')('network');
var Moniker         = require('moniker');
var networkAddress  = require('network-address');
var defaults        = require('./constants.js');
var FilesManagement = require('./files/management.js');
var TaskManager     = require('./tasks/manager.js');
var API             = require('./api.js');
var EventEmitter    = require('events').EventEmitter;
var util            = require('util');

/**
 * Main entry point of Intercom
 * @param {object} opts options
 * - opts.tmp_file       filemanager: default location of sync data
 * - opts.tmp_folder     filemanager: default location of folder uncomp
 * - opts.peer_api_port  api: start port for API (then task p+1++)
 * - opts.ns             (default pm2:fs)
 * - opts.is_file_master (default false)
 * - opts.peer_address   (default network ip)
 */
var Network = function(opts, cb) {
  if (typeof(opts) == 'function') {
    cb = opts;
    opts = {};
  }
  var that = this;

  EventEmitter.call(this);

  this._ns            = opts.ns || 'pm2:fs';
  this.is_file_master = opts.is_file_master || false;
  this.peer_name      = opts.peer_name || Moniker.choose();
  this.peer_address   = opts.peer_address || networkAddress();
  this.peer_api_port  = opts.peer_api_port || 10000;
  this.peers          = [];

  var tmp_file   = opts.tmp_file || defaults.TMP_FILE;
  var tmp_folder = opts.tmp_folder || defaults.TMP_FOLDER;

  this.files_manager = new FilesManagement({
    dest_file  : tmp_file,
    dest_foler : tmp_folder
  });

  this.task_manager = new TaskManager({
    port_offset : that.peer_api_port + 1
  });

  this.api = new API({
    port : that.peer_api_port,
    task_manager : that.task_manager
  });

  // Start network discovery
  this.start(this._ns, function() {
    // Start API
    that.api.start(cb);
  });
};

Network.prototype.close = function() {
  this.api.stop();
};

Network.prototype.handle = function(sock) {
  var that = this;

  this.peers.push(sock);

  debug('status=new peer from=%s total=%d', this.peer_name, this.peers.length);

  sock.on('data', function(packet) {
    try {
      packet = JSON.parse(packet);
    } catch(e) {
      return console.error(e.message);
    }

    switch (packet.cmd) {
      // Task to synchronize this node
    case 'sync':
      console.log('Synchronizing ip=%s port=%s', packet.data.ip, packet.data.port);
      that.files_manager.synchronize(packet.data.ip, packet.data.port);
      break;
    case 'clear':
      that.files_manager.clear();
      break;
    default:
      console.error('Unknow CMD', packet.cmd, packet.data);
    }
  });

  if (that.is_file_master == true) {
    // Send synchronize command
    Network.sendJson(sock, {
      cmd : 'sync',
      data : {
        ip   : that.peer_address,
        port : that.peer_api_port
      }
    });
  }

  sock.on('close', function() {
    debug('Sock on IP: %s disconnected', sock.remoteAddress);
    that.peers.splice(that.peers.indexOf(sock), 1);
  });
};

Network.prototype.start = function(ns, cb) {
  var that = this;

  this.socket = airswarm(ns, function(sock) {
    that.handle(sock);
  });

  this.socket.on('listening', function() {
    debug('status=listening name=%s ip=%s',
          that.peer_name,
          that.peer_address);
    return cb ? cb() : false;
  });
};

Network.prototype.getPeers = function() {
  return this.peers;
};

Network.sendJson = function(sock, data) {
  sock.write(JSON.stringify(data));
};

util.inherits(Network, EventEmitter);

module.exports = Network;