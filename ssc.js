(function(win, doc) {
	// {{{ common
	var logging = console,
		keys = {
			'f1': 'f1',
			'f2': 'f2',
			'f3': 'f3',
			'f4': 'f4',
			'f5': 'f5',
			'f6': 'f6',
			'f7': 'f7',
			'f8': 'f8',
			'f9': 'f9',
			'f10': 'f10',
			'f11': 'f11',
			'f12': 'f12',
			'backspace': 'backspace',
			'tab': 'tab',
			'enter': 'enter',
			'shift': 'shift',
			'control': 'ctrl',
			'alt': 'alt',
			'capslock': 'capslock',
			'escape': 'esc',
			' ': 'space',
			'pageup': 'pageup',
			'pagedown': 'pagedown',
			'end': 'end',
			'home': 'home',
			'arrowleft': 'left',
			'arrowup': 'up',
			'arrowright': 'right',
			'arrowdown': 'down',
			'delete': 'delete',
		},
		buttons = {
			0: 'left',
			1: 'center',
			2: 'right',
		};

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

	function keyboard(key, code) {
		if (key.length == 1) {
			return key
		} else {
			return keys[key.toLowerCase()]
		}
	}

	function mouse(button) {
		return buttons[button]
	}
	// }}}
	// {{{ 图传
	function sharestream(sock, conn, stream, label) {
		return new Promise((resolve, reject) => {
			var promised = false,
				channel = conn.createDataChannel(label);
			stream.getTracks().forEach(track => {
				conn.addTrack(track, stream)
				track.addEventListener('ended', (e) => {
					if (!promised) {
						promised = true;
						channel.close();
						reject(new Error('user ended'));
					}
					return false;
				}, false);
			});
			channel.addEventListener('open', (e) => { logging.info('datachannel ' + label + ' is opened'); return false; }, false);
			channel.addEventListener('close', (e) => { logging.info('datachannel ' + label + ' is closed'); return false; }, false);
			conn.addEventListener('iceconnectionstatechange', (e) => {
				switch (conn.iceConnectionState) {
				case 'connected':
					if (!promised) {
						promised = true;
						resolve(channel);
					}
					break;
				case 'failed':
					if (!promised) {
						promised = true;
						channel.close();
						reject(new Error('RTCPeerConnection iceconnect failed'));
					}
				}
			}, false);
			conn.createOffer().then((offer) => {
				conn.setLocalDescription(offer).then(() => {
					var offers = JSON.stringify(offer);
					logging.trace('sending offer ' + offers);
					sock.send(offers);
					return false;
				}, (reason) => {
					if (!promised) {
						promised = true;
						channel.close();
						reject(reason);
					}
					return false;
				});
			});
		});
	}

	function display(sock, conn, screen) {
		return new Promise((resolve, reject) => {
			var promised = false,
				videoReady = false,
				connectionReady = false,
				video = doc.createElement('video');
			for (var child=screen.lastElementChild; child; child=screen.lastElementChild) {
				screen.removeChild(child);
			}
			video.tabIndex = -1;
			video.autoplay = true;
			screen.appendChild(video);
			conn.addEventListener('track', (e) => {
				logging.trace('received track');
				if (e.streams.length > 0) {
					video.srcObject = e.streams[0];
					video.play();
					videoReady = true;
					if (!promised && connectionReady) {
						promised = true;
						resolve(video);
					}
				}
				return false;
			}, false);
			conn.addEventListener('iceconnectionstatechange', (e) => {
				switch (conn.iceConnectionState) {
				case 'connected':
					connectionReady = true;
					if (!promised && videoReady) {
						promised = true;
						resolve(video);
					}
					break;
				case 'failed':
					if (!promised) {
						promised = true;
						reject(new Error('RTCPeerConnection iceconnect failed'));
					}
				}
			}, false);
		});
	}
	// }}}
	// {{{ 指令
	function shareevents(sock, conn, label, video) {
		return new Promise((resolve, reject) => {
			conn.addEventListener('datachannel', (e) => {
				logging.trace('received datachannel ' + e.channel.label);
				if (e.channel.label == label) {
					var channel = e.channel,
						sharing = false,
						promised = false,
						last = -1;
					channel.addEventListener('open', (e) => {
						logging.info('datachannel ' + label + ' is opened');
						setTimeout(function(){
							if (!promised) {
								promised = true;
								sharing = true;
								resolve();
							}
							return false;
						}, 1000);
						return false;
					}, false);
					channel.addEventListener('close', (e) => {
						logging.info('datachannel ' + label + ' is closed');
						sharing = false;
						if (!promised) {
							promised = true;
							reject(new Error('remote actor is not enabled'));
						}
						return false;
					}, false);

					video.addEventListener('mouseenter', (e) => {video.focus(); return false}, false);
					video.addEventListener('keydown', (e) => {
						if (sharing) {
							e.preventDefault();
							var k = keyboard(e.key, e.code);
							if (k != undefined) {
								if (last != 1) {
									last = 1;
									logging.trace('sending ' + k + ' keydown event');
								}
								channel.send(JSON.stringify({d:1, a:1, k:k}));
							}
						}
						return false;
					}, false);
					video.addEventListener('keypress', (e) => {
						if (sharing) {
							e.preventDefault();
							var k = keyboard(e.key, e.code);
							if (k != undefined) {
								if (last != 2) {
									last = 2
									logging.trace('sending ' + k + ' keypress event');
								}
								channel.send(JSON.stringify({d:1, a:2, k:k}));
							}
						}
						return false;
					}, false);
					video.addEventListener('keyup', (e) => {
						if (sharing) {
							e.preventDefault();
							var k = keyboard(e.key, e.code);
							if (k != undefined) {
								if (last != 3) {
									last = 3;
									logging.trace('sending ' + k + ' keyup event');
								}
								channel.send(JSON.stringify({d:1, a:3, k:k}));
							}
						}
						return false;
					}, false);

					video.addEventListener('contextmenu', (e) => { e.preventDefault(); return false; }, false);
					video.addEventListener('mousemove', (e) => {
						if (sharing) {
							e.preventDefault();
							var rect = video.getBoundingClientRect(),
								evt = {
									d: 2,
									a: 1,
									p: {w: Math.round(rect.width), h: Math.round(rect.height), l: Math.round(e.clientX - rect.left), t: Math.round(e.clientY - rect.top)}
								};
							if (last != 4) {
								last = 4;
								logging.trace('sending mousemove event');
							}
							channel.send(JSON.stringify(evt));
						}
						return false;
					}, false);
					video.addEventListener('mousedown', (e) => {
						if (sharing) {
							e.preventDefault();
							var k = mouse(e.button);
							if (k != undefined) {
								if (last != 5) {
									last = 5;
									logging.trace('sending ' + k + ' mousedown event');
								}
								channel.send(JSON.stringify({d:2, a:2, k:k}));
							}
						}
						return false;
					}, false);
					video.addEventListener('mouseup', (e) => {
						if (sharing) {
							e.preventDefault();
							var k = mouse(e.button);
							if (k != undefined) {
								if (last != 6) {
									last = 6;
									logging.trace('sending ' + k + ' mouseup event');
								}
								channel.send(JSON.stringify({d:2, a:3, k:k}));
							}
						}
						return false;
					}, false);
				}
			}, false);
		});
	}

	function forward(actor, channel) {
		var forwarding = true;
		actor.addEventListener('close', (e) => {
			forwarding = false;
			channel.close();
			return false;
		}, false);
		channel.addEventListener('close', (e) => {
			forwarding = false;
			actor.close();
			return false;
		}, false);
		channel.addEventListener('message', (e) => {
			if (forwarding) {
				logging.trace('forwarding a message from channel to actor');
				actor.send(e.data);
			}
			return false;
		}, false);
		return false;
	}
	// }}}

	function initsettings() {
		var searchParams = new URLSearchParams(win.location.search);
		doc.querySelector('#main .local input[name=id]').value = searchParams.get('main.local.id') || randoms('', 4);
		doc.querySelector('#main .remote input[name=id]').value = searchParams.get('main.remote.id');
		doc.querySelector('#advanced .turn input[name=addr]').value = searchParams.get('advanced.turn.addr');
		doc.querySelector('#advanced .turn input[name=username]').value = searchParams.get('advanced.turn.username');
		doc.querySelector('#advanced .turn input[name=credential]').value = searchParams.get('advanced.turn.credential');
		doc.querySelector('#advanced .signal input[name=addr]').value = searchParams.get('advanced.signal.addr');
		doc.querySelector('#advanced .signal input[name=token]').value = searchParams.get('advanced.signal.token');
		doc.querySelector('#advanced .actor input[name=addr]').value = searchParams.get('advanced.actor.addr');
		return false;
	}

	function bootstrap() {
		var label = 'events',
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
		initsettings();
		win.location.hash = '#main';

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
					var conn = initialize(turncfg, sock)
						button = doc.querySelector('#main .local button[type=reset]'),
						closer = function(e) {
						if (e) {
							e.preventDefault();
							logging.info('click');
						}
						button.removeEventListener('click', closer, false);
						doc.querySelector('#main .local button[type=reset]').disabled = true;
						doc.querySelector('#main .local button[type=submit]').disabled = false;
						conn.close();
						sock.close();
						stream.getTracks().forEach((track) => { track.stop(); });
						return false;
					};
					doc.querySelector('#main .local button[type=submit]').disabled = true;
					doc.querySelector('#main .local button[type=reset]').disabled = false;
					button.addEventListener('click', closer, false);
					stream.getTracks().forEach(track => {
						track.addEventListener('ended', (e) => {
							logging.info('end');
							return closer(null);
						}, false);
					});
					sharestream(sock, conn, stream, label).then((channel) => {
						logging.info('screen is being share');
						socket(doc.querySelector('#advanced .actor input[name=addr]').value).then((actor) => {
							logging.info('actor is ready');
							forward(actor, channel);
							return false;
						}, (reason) => {
							logging.warn(reason);
							logging.warn('local actor is not enabled');
							channel.close();
							return false;
						});
						conn.addEventListener('iceconnectionstatechange', (e) => {
							switch (conn.iceConnectionState) {
							case 'failed':
								logging.info('remote');
								return closer(null);
							}
							return false;
						}, false);
						conn.addEventListener('connectionstatechange', (e) => {
							switch(conn.connectionState) {
							case 'failed':
								logging.info('remote');
								return closer(null);
							}
							return false;
						}, false);
						return false;
					}, (reason) => {
						logging.warn(reason);
						return closer(null);
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
				var conn = initialize(turncfg, sock),
					button = doc.querySelector('#main .remote button[type=reset]'),
					closer = function(e) {
					if (e) {
						e.preventDefault();
						logging.info('click');
					}
					doc.querySelector('#main .remote button[type=reset]').disabled = true;
					doc.querySelector('#main .remote button[type=submit]').disabled = false;
					button.removeEventListener('click', closer, false),
					conn.close();
					sock.close();
					return false;
				};
				button.addEventListener('click', closer, false);
				doc.querySelector('#main .remote button[type=submit]').disabled = true;
				doc.querySelector('#main .remote button[type=reset]').disabled = false;
				display(sock, conn, doc.querySelector('#screen')).then((video) => {
					logging.info('displaying remote screen');
					video.focus();
					shareevents(sock, conn, label, video).then(() => {
						logging.info('sharing events');
						return false;
					}, (reason) => {
						logging.warn(reason);
						return false;
					});
					conn.addEventListener('iceconnectionstatechange', (e) => {
						switch (conn.iceConnectionState) {
						case 'failed':
							logging.info('remote');
							return closer(null);
						}
						return false;
					}, false);
					conn.addEventListener('connectionstatechange', (e) => {
						switch(conn.connectionState) {
						case 'failed':
							logging.info('remote');
							return closer(null);
						}
						return false;
					}, false);
					return false;
				}, (reason) => {
					logging.warn(reason);
					return closer(null);
				});
				doc.querySelector('#screen').scrollIntoView({behavior: 'smooth'});
				return false;
			}, (reason) => {
				logging.error(reason);
				return false;
			});
			return false;
		}, false);

		return true;
	}

	doc.addEventListener('DOMContentLoaded', bootstrap);

	return true;
})(window, document);
