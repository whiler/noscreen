(function(win, doc) {
	// {{{ common
	var logging = console,
		keys = {
			'f1': 'f1', 'f2': 'f2', 'f3': 'f3', 'f4': 'f4', 'f5': 'f5', 'f6': 'f6', 'f7': 'f7', 'f8': 'f8', 'f9': 'f9', 'f10': 'f10', 'f11': 'f11', 'f12': 'f12',
			'arrowleft': 'left', 'arrowup': 'up', 'arrowright': 'right', 'arrowdown': 'down',
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
			'delete': 'delete'
		},
		buttons = {0: 'left', 1: 'center', 2: 'right'};

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
			logging.trace('connecting ' + addr);
		});
	}

	function signal(cfg, src, dst) {
		var addr = doc.querySelector(cfg.addr).value,
			u = null;
		if (!addr.startsWith('ws')) {
			return new Promise((resolve, reject) => { reject(new Error('invalid signal server address')); });
		} else {
			u = new URL(addr);
			u.pathname += u.pathname.endsWith('/') ? src : '/' + src;
			u.searchParams.append('token', doc.querySelector(cfg.token).value);
			return socket(u.toString());
		}
	}

	function actor(addr, token) {
		if (!addr.startsWith('ws')) {
			return new Promise((resolve, reject) => { reject(new Error('invalid actor server address')); });
		} else {
			var u = new URL(addr);
			u.searchParams.append('token', token);
			return socket(u.toString());
		}
	}

	function initialize(turncfg, sock) {
		var cfg = {iceServers: [{urls: ['stun:stun.l.google.com:19302', 'stun:stun.antisip.com:3478']}]},
			conn = null,
			addr = doc.querySelector(turncfg.addr).value,
			username = doc.querySelector(turncfg.username).value,
			credential = doc.querySelector(turncfg.credential).value;

		if (addr.startsWith('stun')) {
			cfg.iceServers.push({urls: [addr]});
		} else if (addr.startsWith('turn') && username != '' && credential != '') {
			cfg.iceServers.push({urls: [addr], username: username, credential: credential});
		} else if (addr) {
			logging.warn('ignore stun/turn ' + addr);
		}

		conn = new RTCPeerConnection(cfg);
		conn.addEventListener('connectionstatechange', (e) => {
			logging.debug('connectionState is ' + conn.connectionState);
			return false;
		}, false);
		conn.addEventListener('negotiationneeded', (e) => {
			// TODO
			logging.trace(e);
			return false;
		}, false);
		conn.addEventListener('signalingstatechange', (e) => {
			logging.debug('signalingState is ' + conn.signalingState);
			return false;
		}, false);
		conn.addEventListener('icecandidateerror', (e) => {
			logging.error(e.errorText);
			return false;
		}, false);
		conn.addEventListener('iceconnectionstatechange', (e) => {
			logging.debug('iceConnectionState is ' + conn.iceConnectionState);
			return false;
		}, false);
		conn.addEventListener('icegatheringstatechange', (e) => {
			logging.debug('iceGatheringState is ' + conn.iceGatheringState);
			return false;
		}, false);
		conn.addEventListener('icecandidate', (e) => {
			var candidate = JSON.stringify(e.candidate);
			logging.trace('sending candidate ' + candidate);
			sock.send(candidate);
			return false;
		}, false);

		sock.addEventListener('message', (e) => {
			var msg = JSON.parse(e.data);
			if (!msg) {
				logging.warn('invalid message ' + e.data);
			} else if (msg.type == 'offer') {
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
			trace: function(msg) { return this.log('trace', msg); },
			debug: function(msg) { return this.log('debug', msg); },
			info: function(msg) { return this.log('info', msg); },
			warn: function(msg) { return this.log('warn', msg); },
			error: function(msg) {
				console.error(msg);
				return this.log('error', msg);
			}
		};
		return false;
	}

	function keyboard(key, code) {
		if (key.length == 1 && key != ' ') {
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
	function sharestream(sock, conn, stream, commandlabel, alivelabel) {
		return new Promise((resolve, reject) => {
			var promised = false,
				command = conn.createDataChannel(commandlabel),
				alive = conn.createDataChannel(alivelabel);
			stream.getTracks().forEach(track => {
				conn.addTrack(track, stream)
				track.addEventListener('ended', (e) => {
					logging.debug('stream is ended');
					if (!promised) {
						promised = true;
						command.close();
						alive.close();
						reject(new Error('abort'));
					}
					return false;
				}, false);
			});
			command.addEventListener('open', (e) => {
				logging.debug('datachannel ' + commandlabel + ' is opened');
				return false;
			}, false);
			command.addEventListener('close', (e) => {
				logging.debug('datachannel ' + commandlabel + ' is closed');
				return false;
			}, false);
			alive.addEventListener('open', (e) => {
				logging.debug('datachannel ' + alivelabel + ' is opened');
				return false;
			}, false);
			alive.addEventListener('close', (e) => {
				logging.debug('datachannel ' + alivelabel + ' is closed');
				return false;
			}, false);
			conn.addEventListener('iceconnectionstatechange', (e) => {
				switch (conn.iceConnectionState) {
				case 'connected':
					if (!promised) {
						promised = true;
						resolve({command: command, alive: alive});
					}
					break;
				case 'failed':
					if (!promised) {
						promised = true;
						command.close();
						alive.close();
						reject(new Error('RTCPeerConnection iceconnect failed'));
					}
				}
			}, false);
			logging.trace('creating offer');
			conn.createOffer().then((offer) => {
				logging.trace('setting local description');
				conn.setLocalDescription(offer).then(() => {
					var offers = JSON.stringify(offer);
					logging.trace('sending offer ' + offers);
					sock.send(offers);
					return false;
				}, (reason) => {
					if (!promised) {
						promised = true;
						command.close();
						alive.close();
						reject(reason);
					}
					return false;
				});
			});
		});
	}

	function display(sock, conn, screen, commandlabel, alivelabel) {
		return new Promise((resolve, reject) => {
			var promised = false,
				videoReady = false,
				commandReady = false, aliveReady = false,
				connectionReady = false,
				video = doc.createElement('video'),
				command = null, alive = null;
			logging.trace('creating video element');
			for (var child=screen.lastElementChild; child; child=screen.lastElementChild) {
				screen.removeChild(child);
			}
			video.tabIndex = -1;
			video.autoplay = true;
			screen.appendChild(video);
			conn.addEventListener('datachannel', (e) => {
				logging.trace('received datachannel ' + e.channel.label);
				if (e.channel.label == commandlabel) {
					command = e.channel;
					commandReady = true;
					command.addEventListener('open', (e) => { logging.debug('datachannel ' + commandlabel + ' is opened'); return false; }, false);
					command.addEventListener('close', (e) => { logging.debug('datachannel ' + commandlabel + ' is closed'); return false; }, false);
					if (!promised && videoReady && connectionReady && aliveReady) {
						promised = true;
						resolve({video:video, command: command, alive: alive});
					}
				} else if (e.channel.label == alivelabel) {
					alive = e.channel;
					aliveReady = true;
					alive.addEventListener('open', (e) => { logging.debug('datachannel ' + alivelabel + ' is opened'); return false; }, false);
					alive.addEventListener('close', (e) => { logging.debug('datachannel ' + alivelabel + ' is closed'); return false; }, false);
					if (!promised && videoReady && connectionReady && commandReady) {
						promised = true;
						resolve({video:video, command: command, alive: alive});
					}
				}
				return false;
			}, false);
			conn.addEventListener('track', (e) => {
				logging.trace('received track');
				if (e.streams.length > 0) {
					video.srcObject = e.streams[0];
					video.play();
					videoReady = true;
					if (!promised && connectionReady && commandReady && aliveReady) {
						promised = true;
						resolve({video:video, command: command, alive: alive});
					}
				}
				return false;
			}, false);
			conn.addEventListener('iceconnectionstatechange', (e) => {
				switch (conn.iceConnectionState) {
				case 'connected':
					connectionReady = true;
					if (!promised && videoReady && commandReady && aliveReady) {
						promised = true;
						resolve({video:video, command: command, alive: alive});
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
	function sharecommands(sock, conn, channel, video) {
		return new Promise((resolve, reject) => {
			var sharing = false,
				promised = false,
				last = -1;
			logging.trace('preparing commands');
			setTimeout(() => {
				if (!promised) {
					promised = true;
					sharing = true;
					resolve();
				}
				return false;
			}, 1000);
			channel.addEventListener('close', (e) => {
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

			video.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				return false;
			}, false);
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
	// {{{ 设置
	function initsettings(endpoint) {
		var searchParams = new URLSearchParams(win.location.search),
			req = new XMLHttpRequest();
		logging.trace('updating settings from search params');
		doc.querySelector('#main .local input[name=id]').value = searchParams.get('main.local.id') || randoms('', 4);
		doc.querySelector('#main .remote input[name=id]').value = searchParams.get('main.remote.id');
		doc.querySelector('#advanced .turn input[name=addr]').value = searchParams.get('advanced.turn.addr');
		doc.querySelector('#advanced .turn input[name=username]').value = searchParams.get('advanced.turn.username');
		doc.querySelector('#advanced .turn input[name=credential]').value = searchParams.get('advanced.turn.credential');
		doc.querySelector('#advanced .signal input[name=addr]').value = searchParams.get('advanced.signal.addr');
		doc.querySelector('#advanced .signal input[name=token]').value = searchParams.get('advanced.signal.token');
		doc.querySelector('#advanced .actor input[name=addr]').value = searchParams.get('advanced.actor.addr');
		doc.querySelector('#advanced .actor input[name=token]').value = searchParams.get('advanced.actor.token');

		req.open('GET', endpoint);
		req.addEventListener('load', (e) => {
			if (req.readyState === req.DONE && req.status === 200) {
				var cfg = JSON.parse(req.responseText),
					node = null;
				logging.trace('updating settings from ' + endpoint);
				if (cfg.main != undefined) {
					if (cfg.main.local != undefined) {
						node = doc.querySelector('#main .local input[name=id]');
						node.value = node.value || cfg.main.local.id || randoms('', 4);
					}
					if (cfg.main.remote != undefined) {
						node = doc.querySelector('#main .remote input[name=id]');
						node.value = node.value || cfg.main.remote.id || '';
					}
				}
				if (cfg.advanced != undefined) {
					if (cfg.advanced.turn != undefined) {
						node = doc.querySelector('#advanced .turn input[name=addr]');
						node.value = node.value || cfg.advanced.turn.addr || '';
						node = doc.querySelector('#advanced .turn input[name=username]');
						node.value = node.value || cfg.advanced.turn.username || '';
						node = doc.querySelector('#advanced .turn input[name=credential]');
						node.value = node.value || cfg.advanced.turn.credential || '';
					}
					if (cfg.advanced.signal != undefined) {
						node = doc.querySelector('#advanced .signal input[name=addr]');
						node.value = node.value || cfg.advanced.signal.addr || '';
						node = doc.querySelector('#advanced .signal input[name=token]');
						node.value = node.value || cfg.advanced.signal.token || '';
					}
					if (cfg.advanced.actor != undefined) {
						node = doc.querySelector('#advanced .actor input[name=addr]');
						node.value = node.value || cfg.advanced.actor.addr || '';
						node = doc.querySelector('#advanced .actor input[name=token]');
						node.value = node.value || cfg.advanced.actor.token || '';
					}
				}
			}
			return false;
		});
		req.send(null);

		return false;
	}
	// }}}

	function bootstrap() {
		var commandlabel = 'command', alivelabel = 'alive',
			turncfg = {
				addr: '#advanced .turn input[name=addr]',
				username: '#advanced .turn input[name=username]',
				credential: '#advanced .turn input[name=credential]'
			},
			signalcfg = {
				addr: '#advanced .signal input[name=addr]',
				token: '#advanced .signal input[name=token]'
			},
			localcfg = '#main .local input[name=id]', remotecfg = '#main .remote input[name=id]';

		initlogger('#logging');
		initsettings('config.json');
		win.location.hash = '#main';

		// {{{ 共享
		doc.querySelector('#main .local').addEventListener('submit', (e) => {
			e.preventDefault();
			var constraints = {
					video: {
						width: screen.width,
						height: screen.height,
						frameRate: {ideal: 10, max: 15},
						cursor: 'always',
						displaySurface: 'monitor'
					},
					audio: false
				},
				actorcfg = {
					addr: '#advanced .actor input[name=addr]',
					token: '#advanced .actor input[name=token]'
				},
				submitcfg = '#main .local button[type=submit]', resetcfg = '#main .local button[type=reset]';
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
				signal(signalcfg, doc.querySelector(localcfg).value, doc.querySelector(remotecfg).value).then((sock) => {
					logging.info('signal is ready');
					var conn = initialize(turncfg, sock),
						button = doc.querySelector(resetcfg),
						closer = function(e) {
						if (e) {
							e.preventDefault();
							logging.info('stop');
						}
						button.removeEventListener('click', closer, false);
						doc.querySelector(resetcfg).disabled = true;
						doc.querySelector(submitcfg).disabled = false;
						conn.close();
						sock.close();
						stream.getTracks().forEach((track) => { track.stop(); });
						return false;
					};
					doc.querySelector(submitcfg).disabled = true;
					doc.querySelector(resetcfg).disabled = false;
					button.addEventListener('click', closer, false);
					stream.getTracks().forEach(track => {
						track.addEventListener('ended', (e) => {
							logging.info('stop');
							return closer(null);
						}, false);
					});
					sharestream(sock, conn, stream, commandlabel, alivelabel).then((channels) => {
						logging.info('sharing the stream');
						actor(doc.querySelector(actorcfg.addr).value, doc.querySelector(actorcfg.token).value).then((proxy) => {
							logging.info('forwarding commands to actor');
							forward(proxy, channels.command);
							return false;
						}, (reason) => {
							logging.warn(reason);
							logging.warn('local actor is not enabled');
							channels.command.close();
							return false;
						});
						channels.alive.addEventListener('close', (e) => {
							logging.info('stopped');
							return closer(null);
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
		// }}}
		// {{{ 控制
		doc.querySelector('#main .remote').addEventListener('submit', (e) => {
			e.preventDefault();
			var submitcfg = '#main .remote button[type=submit]', resetcfg = '#main .remote button[type=reset]';
			signal(signalcfg, doc.querySelector(remotecfg).value, doc.querySelector(localcfg).value).then((sock) => {
				logging.info('signal is ready');
				var conn = initialize(turncfg, sock),
					button = doc.querySelector(resetcfg),
					closer = function(e) {
					if (e) {
						e.preventDefault();
						logging.info('stop');
					}
					doc.querySelector(resetcfg).disabled = true;
					doc.querySelector(submitcfg).disabled = false;
					button.removeEventListener('click', closer, false),
					conn.close();
					sock.close();
					return false;
				};
				button.addEventListener('click', closer, false);
				doc.querySelector(submitcfg).disabled = true;
				doc.querySelector(resetcfg).disabled = false;
				display(sock, conn, doc.querySelector('#screen'), commandlabel, alivelabel).then((media) => {
					logging.info('displaying remote screen');
					media.video.focus();
					sharecommands(sock, conn, media.command, media.video).then(() => {
						logging.info('sharing commands');
						return false;
					}, (reason) => {
						logging.warn(reason);
						return false;
					});
					media.alive.addEventListener('close', (e) => {
						logging.info('stopped');
						return closer(null);
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
		// }}}

		return true;
	}

	doc.addEventListener('DOMContentLoaded', bootstrap);

	return true;
})(window, document);
