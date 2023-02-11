(function(win, doc) {
	// {{{ common
	var logging = console,
		label = 'cmd';

	function randoms(prefix, size) {
		var chars = '0123456789',
			cap = chars.length,
			s = prefix;
		for (var i = 0; i<size; i++) {
			s += chars.charAt(Math.floor(Math.random() * cap));
		}
		return s;
	}

	function socket(addr) {
		return new Promise((resolve, reject) => {
			var sock = new WebSocket(addr);
			sock.addEventListener('open', (e) => {
				logging.debug('WebSocket(' + addr + ') is opened');
				resolve(sock);
			}, false);
			sock.addEventListener('error', (e) => { reject(new Error('WebSocket(' + addr + ') error')); }, false);
			sock.addEventListener('close', (e) => { logging.debug('WebSocket(' + addr + ') is closed'); }, false);
		});
	}

	function signal(cfg, src, dst) {
		var u = new URL(doc.querySelector(cfg.addr).value);
		u.pathname += u.pathname.endsWith('/') ? src : '/' + src;
		u.searchParams.append('token', doc.querySelector(cfg.token).value);
		return socket(u.toString());
	}

	function initialize(turncfg, sock) {
		var cfg = {iceServers: [{urls: ['stun:stun.l.google.com:19302', 'stun:stun.qq.com:3478']}]},
			conn = null,
			addr = doc.querySelector(turncfg.addr).value,
			username = doc.querySelector(turncfg.username).value,
			credential = doc.querySelector(turncfg.credential).value;

		if (addr.startsWith('stun')) {
			cfg.iceServers.push({urls: [addr]});
		} else if (addr.startsWith('turn') && username != '' && credential != '') {
			cfg.iceServers.push({urls: [addr], username: username, credential: credential});
		} else if (turn) {
			logging.warn('ignore stun/turn ' + addr);
		}

		conn = new RTCPeerConnection(cfg);
		conn.addEventListener('connectionstatechange', (e) => { logging.info('connectionState is ' + conn.connectionState); return false; }, false);
		conn.addEventListener('negotiationneeded', (e) => { logging.trace(e); }, false);
		conn.addEventListener('signalingstatechange', (e) => { logging.info('signalingState is ' + conn.signalingState); }, false);
		conn.addEventListener('icecandidateerror', (e) => {logging.error(e);}, false);
		conn.addEventListener('iceconnectionstatechange', (e) => { logging.info('iceConnectionState is ' + conn.iceConnectionState); }, false);
		conn.addEventListener('icegatheringstatechange', (e) => { logging.info('iceGatheringState is ' + conn.iceGatheringState); }, false);
		conn.addEventListener('icecandidate', (e) => {
			if (e.candidate) {
				var candidate = JSON.stringify(e.candidate);
				logging.trace('sending candidate ' + candidate);
				sock.send(candidate);
			}
			return false;
		}, false);

		sock.addEventListener('message', (e) => {
			var msg = JSON.parse(e.data);
			if (msg.type == 'offer') {
				logging.trace('received offer ' + e.data);
				conn.setRemoteDescription(msg).then(() => {
					conn.createAnswer().then((answer)=>{
						conn.setLocalDescription(answer).then(() => {
							var answers = JSON.stringify(answer);
							logging.trace('sending answer ' + answers);
							sock.send(answers);
						});
					});
				});
			} else if (msg.type == 'answer') {
				logging.trace('received answer ' + e.data);
				conn.setRemoteDescription(msg);
			} else if (msg.candidate != undefined) {
				logging.trace('received candidate ' + e.data);
				conn.addIceCandidate(msg);
			} else {
				logging.trace(e.data);
			}
			return false;
		}, false);

		logging.debug('RTCPeerConnection is initialized with ' + JSON.stringify(cfg));
		return conn;
	}

	function initlogger(path) {
		var node = doc.querySelector(path);
		logging = {
			log: function(level, msg) {
				var p = doc.createElement('p');
				p.className = level;
				p.innerHTML = '<time>' + (new Date()).toLocaleTimeString() + '</time><i>' + msg + '</i>';
				node.appendChild(p);
				return false;
			},
			debug: function(msg) {
				return this.log('debug', msg);
			},
			error: function(msg) {
				console.error(msg);
				return this.log('error', msg);
			},
			info: function(msg) {
				return this.log('info', msg);
			},
			trace: function(msg) {
				return this.log('trace', msg);
			},
			warn: function(msg) {
				return this.log('warn', msg);
			},
		};
		return false;
	}
	// }}}

	function sharestream(sock, conn, stream) {
		return new Promise((resolve, reject) => {
			var promised = false;
			stream.getTracks().forEach(track => {
				conn.addTrack(track, stream)
				track.addEventListener('ended', (e) => {
					if (!promised) {
						promised = true;
						reject(new Error('User ended'));
					}
					return false;
				}, false);
			});
			conn.createOffer().then((offer) => {
				conn.setLocalDescription(offer).then(() => {
					var offers = JSON.stringify(offer);
					logging.trace('sending offer ' + offers);
					sock.send(offers);
				});
			});
			conn.addEventListener('connectionstatechange', (e) => {
				switch (conn.connectionState) {
				case 'connected':
					if (!promised) {
						promised = true;
						resolve();
					}
					break;
				}
			}, false);
		});
	}

	function display(sock, conn, path) {
		return new Promise((resolve, reject) => {
			conn.addEventListener('track', (e) => {
				logging.trace('received track');
				if (e.streams.length > 0) {
					var video = doc.querySelector(path),
					video.srcObject = e.streams[0];
					video.play();
					resolve();
				}
				return false;
			}, false);
		});
	}

	function bootstrap() {
		var shareState = 0,
			turncfg = {
				addr: '#advanced .turn input[name=addr]',
				username: '#advanced .turn input[name=username]',
				credential: '#advanced .turn input[name=credential]'
			},
			signalcfg = {
				addr: '#advanced .signal input[name=addr]',
				token: '#advanced .signal input[name=token]'
			};
		initlogger('#logging');
		doc.querySelector('#main .local input[name=id]').value = randoms('', 4);

		// 共享
		doc.querySelector('#main .local').addEventListener('submit', (e) => {
			e.preventDefault();
			var constraints = {
				video: {
					width: screen.width,
					height: screen.height,
					frameRate: {ideal: 12, max: 20},
					cursor: 'always',
					displaySurface: 'monitor'
				},
				audio: false
			};
			navigator.mediaDevices.getDisplayMedia(constraints).then((stream) => {
				logging.info('display media stream(' + stream.id + ') is ready');
				stream.getTracks().forEach((track) => {
					switch (track.kind) {
					case 'video':
						var settings = track.getSettings();
						logging.debug('video(' + track.id + ') is ' + settings.width + 'x' +  settings.height + '@' + settings.frameRate);
						break;
					}
				});
				signal(signalcfg, doc.querySelector('#main .local input[name=id]').value, doc.querySelector('#main .remote input[name=id]').value).then((sock) => {
					logging.info('signal is ready');
					var conn = initialize(turncfg, sock);
					sharestream(sock, conn, stream).then(() => {
						logging.info('screen is being share');
						return false;
					}, (reason) => {
						logging.warn(reason);
						conn.close();
						sock.close();
						stream.getTracks().forEach((track) => { track.stop(); });
						return false;
					});
					return false;
				}, (reason) => {
					logging.warn(reason);
					stream.getTracks().forEach((track) => { track.stop(); });
					return false;
				});
			});
			return false;
		}, false);

		// 控制
		doc.querySelector('#main .remote').addEventListener('submit', (e) => {
			e.preventDefault();
			signal(signalcfg, doc.querySelector('#main .remote input[name=id]').value, doc.querySelector('#main .local input[name=id]').value).then((sock) => {
				logging.info('signal is ready');
				var conn = initialize(turncfg, sock);
				display(sock, conn, '#screen video').then(() => {
					logging.info('displaying remote screen');
					return false;
				}, (reason) => {
					logging.warn(reason);
					conn.close();
					sock.close();
					return false;
				});
				return false;
			}, (reason) => {
				logging.error(reason);
				return false;
			});
			return false;
		}, false);

		return true;
	}

	if (doc.readyState == 'loading') {
		doc.addEventListener('DOMContentLoaded', bootstrap);
	} else {
		bootstrap();
	}

	return true;
})(window, document);
