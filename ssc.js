(function(win, doc) {
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

	function initialize(turncfg, sock) {
		return new Promise((resolve, reject) => {
			var cfg = {iceServers: [{urls: ['stun:stun.l.google.com:19302', 'stun:stun.qq.com:3478']}]},
				conn = null,
				turn = doc.querySelector(turncfg.turn).value,
				username = doc.querySelector(turncfg.username).value,
				credential = doc.querySelector(turncfg.credential).value;

			if (turn.startsWith('stun')) {
				cfg.iceServers.push({urls: [turn]});
			} else if (turn.startsWith('turn') && username != '' && credential != '') {
				cfg.iceServers.push({urls: [turn], username: username, credential: credential});
			} else if (turn) {
				logging.debug('ignore turn ' + turn);
			}

			conn = new RTCPeerConnection(cfg);
			conn.addEventListener('connectionstatechange', (e) => {
				logging.trace('connectionState is ' + conn.connectionState);
				switch (conn.connectionState) {
				case 'connected':
					resolve(conn);
					break;
				case 'failed':
					reject(new Error('RTCPeerConnection failed'));
					break;
				}
			}, false);
			conn.addEventListener('icecandidate', (e) => {
				if (e.candidate) {
					var candidate = JSON.stringify(e.candidate);
					logging.trace('sending candidate ' + candidate);
					sock.send(candidate);
				}
				return false;
			}, false);
			conn.addEventListener('icecandidateerror', (e) => {logging.error(e);}, false);
			conn.addEventListener('iceconnectionstatechange', (e) => { logging.trace('iceConnectionState is ' + conn.iceConnectionState); }, false);
			conn.addEventListener('icegatheringstatechange', (e) => { logging.trace('iceGatheringState is ' + conn.iceGatheringState); }, false);
			conn.addEventListener('negotiationneeded', (e) => { logging.trace(e); }, false);
			conn.addEventListener('signalingstatechange', (e) => { logging.trace('signalingState is ' + conn.signalingState); }, false);

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
		});
	}

	function control(sock, conn, path) {
		return new Promise((resolve, reject) => {
			var video = doc.querySelector(path),
				requirements = 2;
			conn.addEventListener('track', (e) => {
				logging.trace('received track');
				if (e.streams.length > 0) {
					video.srcObject = e.streams[0];
					video.play();
					requirements--;
					if (requirements <= 0) {
						resolve();
					}
				}
				return false;
			}, false);
			conn.addEventListener('datachannel', (e) => {
				logging.trace('received datachannel');
				var channel = e.channel;
				if (channel.label == label) {
					channel.addEventListener('open', (e) => {
						doc.addEventListener('keydown', (e) => {
							logging.trace('sending keydown');
							channel.send(JSON.stringify({l:1, t: 1, k: e.keyCode}));
							return false;
						}, false);
						doc.addEventListener('keypress', (e) => {
							logging.trace('sending keypress');
							channel.send(JSON.stringify({l:1, t: 2, k: e.keyCode}));
							return false;
						}, false);
						doc.addEventListener('keyup', (e) => {
							logging.trace('sending keyup');
							channel.send(JSON.stringify({l:1, t: 3, k: e.keyCode}));
							return false;
						}, false);

						video.addEventListener('mousemove', (e) => {
							var rect = video.getBoundingClientRect();
							logging.trace('sending mousemove');
							channel.send(JSON.stringify({
								l: 2,
								t: 1,
								s: {w: Math.round(rect.width), h: Math.round(rect.height)},
								p: {l: Math.round(e.clientX - rect.left), t: Math.round(e.clientY - rect.top)}
							}));
							return false;
						}, false);
						video.addEventListener('mousedown', (e) => {
							logging.trace('sending mousedown');
							channel.send(JSON.stringify({
								l: 2,
								t: 2,
								k: e.button,
							}));
							return false;
						}, false);
						requirements--;
						if (requirements <= 0) {
							resolve();
						}
						return false;
					}, false);
				}
				return false;
			}, false);
		});
	}

	function share(sock, conn, stream, actor) {
		return new Promise((resolve, reject) => {
			var channel = conn.createDataChannel(label);
			channel.addEventListener('open', (e) => {
				logging.trace('command channel is opened');
				return false;
			}, false);
			channel.addEventListener('close', (e) => {
				logging.trace('command channel is closed');
				return false;
			}, false);
			channel.addEventListener('message', (e) => {
				logging.trace('forward a command from channel to actor');
				actor.send(e.data);
				return false;
			}, false);
			stream.getTracks().forEach(track => {
				conn.addTrack(track, stream)
				track.addEventListener('ended', (e) => {
					reject(new Error('User ended'));
				}, false);
			});
			conn.createOffer().then((offer)=>{
				conn.setLocalDescription(offer).then(() => {
					var offers = JSON.stringify(offer);
					logging.trace('sending offer ' + offers);
					sock.send(offers);
				});
			});
			conn.addEventListener('connectionstatechange', (e) => {
				switch (conn.connectionState) {
				case 'connected':
					resolve(channel);
					break;
				case 'failed':
					reject(new Error('RTCPeerConnection connect failed'));
					break
				}
			}, false);
		});
	}

	function socket(addr) {
		return new Promise((resolve, reject) => {
			var sock = new WebSocket(addr);
			sock.addEventListener('open', (e) => {
				logging.debug('WebSocket('+addr+') is opened');
				resolve(sock);
			}, false);
			sock.addEventListener('error', (e) => { reject(new Error('WebSocket('+addr+') error')); }, false);
			sock.addEventListener('close', (e) => { logging.debug('WebSocket('+addr+') is closed'); }, false);
		});
	}

	function signal(cfg, id) {
		var u = new URL(doc.querySelector(cfg.signal).value);
		u.pathname += u.pathname.endsWith('/') ? id : '/' + id;
		u.searchParams.append('token', doc.querySelector(cfg.token).value);
		return socket(u.toString());
	}

	function bootstrap() {
		var shareState = 0,
			turncfg = {
				turn: '#advanced .turn input[name=turn]',
				username: '#advanced .turn input[name=username]',
				credential: '#advanced .turn input[name=credential]'
			},
			signalcfg = {
				signal: '#advanced .signal input[name=signal]',
				token: '#advanced .signal input[name=token]'
			},
			logger = doc.querySelector('#logging');
		logging = {
			log: function(level, msg) {
				var p = doc.createElement('p');
				p.className = level;
				p.innerHTML = '<time>' + (new Date()).toLocaleTimeString() + '</time><i>' + msg + '</i>';
				logger.appendChild(p);
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
		doc.querySelector('#main .local input[name=id]').value = randoms('', 4);
		// 共享
		doc.querySelector('#main .local').addEventListener('submit', (e) => {
			e.preventDefault();
			var constraints = {video: {cursor: 'always', frameRate: {ideal: 10, max: 15}, displaySurface: 'monitor'}, audio: false};
			navigator.mediaDevices.getDisplayMedia(constraints).then(
				(stream) => {
					logging.info('display media stream is ready');
					signal(signalcfg, doc.querySelector('#main .local input[name=id]').value).then(
						(sock) => {
							logging.info('signal is ready');
							socket(doc.querySelector('#advanced .actor input[name=actor]').value).then(
								(actor) => {
									var conn = initialize(turncfg, sock);
									logging.info('actor is ready');
									doc.querySelector('#main .local button[type=submit]').disabled = true;
									doc.querySelector('#main .local button[type=reset]').disabled = false;
									share(sock, conn, stream, actor).then(
										(channel) => {
											logging.info('sharing');
										},
										(reason) => {
											logging.error(reason);
											conn.close();
											actor.close();
											sock.close();
											stream.getTracks().forEach((track) => { track.stop(); });
											return false;
										}
									);
									return false;
								},
								(reason) => {
									logging.error(reason);
									sock.close();
									stream.getTracks().forEach((track) => { track.stop(); });
									return false;
								}
							);
							return false;
						},
						(reason) => {
							logging.error(reason);
							stream.getTracks().forEach((track) => { track.stop(); });
							return false;
						}
					);
					return false;
				},
				(reason) => {
					logging.error(reason);
					return false;
				}
			);
			return false;
		}, false);
		// 控制
		doc.querySelector('#main .remote').addEventListener('submit', (e) => {
			e.preventDefault();
			signal(signalcfg, doc.querySelector('#main .remote input[name=id]').value).then(
				(sock) => {
					logging.info('signal is ready');
					control(sock, initialize(turncfg, sock), '#screen video').then(
						() => {
							logging.info('controling');
						},
						(reason) => {
							logging.error(reason);
							sock.close();
							return false;
						}
					);
					return false;
				},
				(reason) => {
					logging.error(reason);
					return false;
				}
			);
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
