;(function() {
	'use strict'

	var ARController = function(width, height, camera) {
		var id;
		var w = width, h = height;

		this.orientation = 'landscape';

		this.listeners = {};

		if (typeof width !== 'number') {
			var image = width;
			camera = height;
			w = image.videoWidth || image.width;
			h = image.videoHeight || image.height;
			this.image = image;
		}

		this.defaultMarkerWidth = 1;
		this.patternMarkers = {};
		this.barcodeMarkers = {};
		this.transform_mat = new Float32Array(16);

		this.canvas = document.createElement('canvas');
		this.canvas.width = w;
		this.canvas.height = h;
		this.ctx = this.canvas.getContext('2d');

		this.videoWidth = w;
		this.videoHeight = h;

		if (typeof camera === 'string') {

			var self = this;
			this.cameraParam = new ARCameraParam(camera, function() {
				self._initialize();
			}, function(err) {
				console.error("ARController: Failed to load ARCameraParam", err);
			});

		} else {

			this.cameraParam = camera;
			this._initialize();

		}
	};


	ARController.prototype.dispose = function() {
		artoolkit.teardown(this.id);

		for (var t in this) {
			this[t] = null;
		}
	};

	ARController.prototype.process = function(image) {
		this.detectMarker(image);

		var markerNum = this.getMarkerNum();
		var k,o;
		for (k in this.patternMarkers) {
			o = this.patternMarkers[k]
			o.inPrevious = o.inCurrent;
			o.inCurrent = false;
		}
		for (k in this.barcodeMarkers) {
			o = this.barcodeMarkers[k]
			o.inPrevious = o.inCurrent;
			o.inCurrent = false;
		}

		for (var i=0; i<markerNum; i++) {
			var markerInfo = this.getMarker(i);

			var markerType = artoolkit.UNKNOWN_MARKER;
			var visible = this.trackPatternMarkerId(-1);

			if (markerInfo.idPatt > -1 && (markerInfo.id === markerInfo.idPatt || markerInfo.idMatrix === -1)) {
				visible = this.trackPatternMarkerId(markerInfo.idPatt);
				markerType = artoolkit.PATTERN_MARKER;

				if (markerInfo.dir !== markerInfo.dirPatt) {
					this.setMarkerInfoDir(i, markerInfo.dirPatt);
				}

			} else if (markerInfo.idMatrix > -1) {
				visible = this.trackBarcodeMarkerId(markerInfo.idMatrix);
				markerType = artoolkit.BARCODE_MARKER;

				if (markerInfo.dir !== markerInfo.dirMatrix) {
					this.setMarkerInfoDir(i, markerInfo.dirMatrix);
				}
			}

			if (markerType !== artoolkit.UNKNOWN_MARKER && visible.inPrevious) {
				this.getTransMatSquareCont(i, visible.markerWidth, visible.matrix, visible.matrix);
			} else {
				this.getTransMatSquare(i, visible.markerWidth, visible.matrix);
			}

			visible.inCurrent = true;
			this.transMatToGLMat(visible.matrix, this.transform_mat);
			this.dispatchEvent({
				name: 'getMarker',
				target: this,
				data: {
					index: i,
					type: markerType,
					marker: markerInfo,
					matrix: this.transform_mat
				}
			});
		}

		var multiMarkerCount = this.getMultiMarkerCount();
		for (var i=0; i<multiMarkerCount; i++) {
			var subMarkerCount = this.getMultiMarkerPatternCount(i);
			var visible = false;

			artoolkit.getTransMatMultiSquareRobust(this.id, i);
			this.transMatToGLMat(this.marker_transform_mat, this.transform_mat);
			for (var j=0; j<subMarkerCount; j++) {
				var multiEachMarkerInfo = this.getMultiEachMarker(i, j);
				if (multiEachMarkerInfo.visible >= 0) {
					visible = true;
					this.dispatchEvent({
						name: 'getMultiMarker',
						target: this,
						data: {
							multiMarkerId: i,
							matrix: this.transform_mat
						}
					});
					break;
				}
			}
			if (visible) {
				for (var j=0; j<subMarkerCount; j++) {
					var multiEachMarkerInfo = this.getMultiEachMarker(i, j);
					this.transMatToGLMat(this.marker_transform_mat, this.transform_mat);
					this.dispatchEvent({
						name: 'getMultiMarkerSub',
						target: this,
						data: {
							multiMarkerId: i,
							markerIndex: j,
							marker: multiEachMarkerInfo,
							matrix: this.transform_mat
						}
					});
				}
			}
		}
		if (this._bwpointer) {
			this.debugDraw();
		}
	};

	
	ARController.prototype.trackPatternMarkerId = function(id, markerWidth) {
		var obj = this.patternMarkers[id];
		if (!obj) {
			this.patternMarkers[id] = obj = {
				inPrevious: false,
				inCurrent: false,
				matrix: new Float32Array(12),
				markerWidth: markerWidth || this.defaultMarkerWidth
			};
		}
		if (markerWidth) {
			obj.markerWidth = markerWidth;
		}
		return obj;
	};


	ARController.prototype.trackBarcodeMarkerId = function(id, markerWidth) {
		var obj = this.barcodeMarkers[id];
		if (!obj) {
			this.barcodeMarkers[id] = obj = {
				inPrevious: false,
				inCurrent: false,
				matrix: new Float32Array(12),
				markerWidth: markerWidth || this.defaultMarkerWidth
			};
		}
		if (markerWidth) {
			obj.markerWidth = markerWidth;
		}
		return obj;
	};


	ARController.prototype.getMultiMarkerCount = function() {
		return artoolkit.getMultiMarkerCount(this.id);
	};


	ARController.prototype.getMultiMarkerPatternCount = function(multiMarkerId) {
		return artoolkit.getMultiMarkerNum(this.id, multiMarkerId);
	};


	ARController.prototype.addEventListener = function(name, callback) {
       if (!this.listeners[name]) {
			this.listeners[name] = [];
		}
		this.listeners[name].push(callback);
	};


	ARController.prototype.removeEventListener = function(name, callback) {
		if (this.listeners[name]) {
			var index = this.listeners[name].indexOf(callback);
			if (index > -1) {
				this.listeners[name].splice(index, 1);
			}
		}
	};


	ARController.prototype.dispatchEvent = function(event) {
		var listeners = this.listeners[event.name];
		if (listeners) {
			for (var i=0; i<listeners.length; i++) {
				listeners[i].call(this, event);
			}
		}
	};


	ARController.prototype.debugSetup = function() {
		document.body.appendChild(this.canvas)
		this.setDebugMode(1);
		this._bwpointer = this.getProcessingImage();
	};


	ARController.prototype.loadMarker = function(markerURL, onSuccess, onError) {
		return artoolkit.addMarker(this.id, markerURL, onSuccess, onError);
	};


	ARController.prototype.loadMultiMarker = function(markerURL, onSuccess, onError) {
		return artoolkit.addMultiMarker(this.id, markerURL, onSuccess, onError);
	};
	

	ARController.prototype.getTransMatSquare = function(markerIndex, markerWidth, dst) {
		artoolkit.getTransMatSquare(this.id, markerIndex, markerWidth);
		dst.set(this.marker_transform_mat);
		return dst;
	};


	ARController.prototype.getTransMatSquareCont = function(markerIndex, markerWidth, previousMarkerTransform, dst) {
		this.marker_transform_mat.set(previousMarkerTransform)
		artoolkit.getTransMatSquareCont(this.id, markerIndex, markerWidth);
		dst.set(this.marker_transform_mat);
		return dst;
	};


	ARController.prototype.getTransMatMultiSquare = function(multiMarkerId, dst) {
		artoolkit.getTransMatMultiSquare(this.id, multiMarkerId);
		dst.set(this.marker_transform_mat);
		return dst;
	};

	
	ARController.prototype.getTransMatMultiSquareRobust = function(multiMarkerId, dst) {
		artoolkit.getTransMatMultiSquare(this.id, multiMarkerId);
		dst.set(this.marker_transform_mat);
		return dst;
	};


	ARController.prototype.transMatToGLMat = function(transMat, glMat, scale) {
		glMat[0 + 0*4] = transMat[0]; // R1C1
		glMat[0 + 1*4] = transMat[1]; // R1C2
		glMat[0 + 2*4] = transMat[2];
		glMat[0 + 3*4] = transMat[3];
		glMat[1 + 0*4] = transMat[4]; // R2
		glMat[1 + 1*4] = transMat[5];
		glMat[1 + 2*4] = transMat[6];
		glMat[1 + 3*4] = transMat[7];
		glMat[2 + 0*4] = transMat[8]; // R3
		glMat[2 + 1*4] = transMat[9];
		glMat[2 + 2*4] = transMat[10];
		glMat[2 + 3*4] = transMat[11];
		glMat[3 + 0*4] = 0.0;
		glMat[3 + 1*4] = 0.0;
		glMat[3 + 2*4] = 0.0;
		glMat[3 + 3*4] = 1.0;
		if (scale != undefined && scale !== 0.0) {
			glMat[12] *= scale;
			glMat[13] *= scale;
			glMat[14] *= scale;
		}
		return glMat;
	};


	ARController.prototype.detectMarker = function(image) {
		if (this._copyImageToHeap(image)) {
			return artoolkit.detectMarker(this.id);
		}
		return -99;
	};


	ARController.prototype.getMarkerNum = function() {
		return artoolkit.getMarkerNum(this.id);
	};

	
	ARController.prototype.getMarker = function(markerIndex) {
		if (0 === artoolkit.getMarker(this.id, markerIndex)) {
			return artoolkit.markerInfo;
		}
	};

	
	ARController.prototype.setMarkerInfoVertex = function(markerIndex, vertexData) {
		for (var i=0; i<vertexData.length; i++) {
			this.marker_transform_mat[i*2+0] = vertexData[i][0];
			this.marker_transform_mat[i*2+1] = vertexData[i][1];
		}
		return artoolkit.setMarkerInfoVertex(this.id, markerIndex);
	};


	ARController.prototype.cloneMarkerInfo = function(markerInfo) {
		return JSON.parse(JSON.stringify(markerInfo));
	};


	ARController.prototype.getMultiEachMarker = function(multiMarkerId, markerIndex) {
		if (0 === artoolkit.getMultiEachMarker(this.id, multiMarkerId, markerIndex)) {
			return artoolkit.multiEachMarkerInfo;
		}
	};



	ARController.prototype.getTransformationMatrix = function() {
		return this.transform_mat;
	};


	ARController.prototype.getCameraMatrix = function() {
		return this.camera_mat;
	};


	ARController.prototype.getMarkerTransformationMatrix = function() {
		return this.marker_transform_mat;
	};



	ARController.prototype.setDebugMode = function(mode) {
		return artoolkit.setDebugMode(this.id, mode);
	};


	ARController.prototype.getDebugMode = function() {
		return artoolkit.getDebugMode(this.id);
	};


	ARController.prototype.getProcessingImage = function() {
		return artoolkit.getProcessingImage(this.id);
	}


	ARController.prototype.setLogLevel = function(mode) {
		return artoolkit.setLogLevel(mode);
	};

	ARController.prototype.getLogLevel = function() {
		return artoolkit.getLogLevel();
	};

	ARController.prototype.setMarkerInfoDir = function(markerIndex, dir) {
		return artoolkit.setMarkerInfoDir(this.id, markerIndex, dir);
	};

	ARController.prototype.setProjectionNearPlane = function(value) {
		return artoolkit.setProjectionNearPlane(this.id, value);
	};

	ARController.prototype.getProjectionNearPlane = function() {
		return artoolkit.getProjectionNearPlane(this.id);
	};

	ARController.prototype.setProjectionFarPlane = function(value) {
		return artoolkit.setProjectionFarPlane(this.id, value);
	};

	ARController.prototype.getProjectionFarPlane = function() {
		return artoolkit.getProjectionFarPlane(this.id);
	};



 	ARController.prototype.setThresholdMode = function(mode) {
		return artoolkit.setThresholdMode(this.id, mode);
	};


	ARController.prototype.getThresholdMode = function() {
		return artoolkit.getThresholdMode(this.id);
	};


	ARController.prototype.setThreshold = function(threshold) {
		return artoolkit.setThreshold(this.id, threshold);
	};


	ARController.prototype.getThreshold = function() {
		return artoolkit.getThreshold(this.id);
	};


	
	ARController.prototype.setPatternDetectionMode = function(value) {
		return artoolkit.setPatternDetectionMode(this.id, value);
	};

	
	ARController.prototype.getPatternDetectionMode = function() {
		return artoolkit.getPatternDetectionMode(this.id);
	};

	
	ARController.prototype.setMatrixCodeType = function(value) {
		return artoolkit.setMatrixCodeType(this.id, value);
	};

	
	ARController.prototype.getMatrixCodeType = function() {
		return artoolkit.getMatrixCodeType(this.id);
	};

	
	ARController.prototype.setLabelingMode = function(value) {
		return artoolkit.setLabelingMode(this.id, value);
	};

	
	ARController.prototype.getLabelingMode = function() {
		return artoolkit.getLabelingMode(this.id);
	};

	
 	ARController.prototype.setPattRatio = function(value) {
		return artoolkit.setPattRatio(this.id, value);
	};


	ARController.prototype.getPattRatio = function() {
		return artoolkit.getPattRatio(this.id);
	};

	
	ARController.prototype.setImageProcMode = function(value) {
		return artoolkit.setImageProcMode(this.id, value);
	};

	
	ARController.prototype.getImageProcMode = function() {
		return artoolkit.getImageProcMode(this.id);
	};



	ARController.prototype.debugDraw = function() {
		var debugBuffer = new Uint8ClampedArray(Module.HEAPU8.buffer, this._bwpointer, this.framesize);
		var id = new ImageData(debugBuffer, this.canvas.width, this.canvas.height)
		this.ctx.putImageData(id, 0, 0)

		var marker_num = this.getMarkerNum();
		for (var i=0; i<marker_num; i++) {
			this._debugMarker(this.getMarker(i));
		}
	};



	ARController.prototype._initialize = function() {
		this.id = artoolkit.setup(this.canvas.width, this.canvas.height, this.cameraParam.id);

		var params = artoolkit.frameMalloc;
		this.framepointer = params.framepointer;
		this.framesize = params.framesize;

		this.dataHeap = new Uint8Array(Module.HEAPU8.buffer, this.framepointer, this.framesize);

		this.camera_mat = new Float64Array(Module.HEAPU8.buffer, params.camera, 16);
		this.marker_transform_mat = new Float64Array(Module.HEAPU8.buffer, params.transform, 12);

		this.setProjectionNearPlane(0.1)
		this.setProjectionFarPlane(1000);

		var self = this;
		setTimeout(function() {
			if (self.onload) {
				self.onload();
			}
			self.dispatchEvent({
				name: 'load',
				target: self
			});
		}, 1);
	};

	ARController.prototype._copyImageToHeap = function(image) {
		if (!image) {
			image = this.image;
		}

		if( (image.nodeName === 'IMG' && image.width > image.height ) ||
			(image.nodeName === 'VIDEO' && image.videoWidth > image.videoHeight) ){
			this.ctx.drawImage(image, 0, 0, this.canvas.width, this.canvas.height); // draw video
		}else{
			this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
			var scale = this.canvas.height / this.canvas.width;
			var scaledHeight = this.canvas.width*scale;
			var scaledWidth = this.canvas.height*scale;
			var marginLeft = ( this.canvas.width - scaledWidth)/2;
			this.ctx.drawImage(image, marginLeft, 0, scaledWidth, scaledHeight); // draw video
		}

		var imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
		var data = imageData.data;

		if (this.dataHeap) {
			this.dataHeap.set( data );
			return true;
		}
		return false;
	};
	
	ARController.prototype._debugMarker = function(marker) {
		var vertex, pos;
		vertex = marker.vertex;
		var ctx = this.ctx;
		ctx.strokeStyle = 'red';

		ctx.beginPath()
		ctx.moveTo(vertex[0][0], vertex[0][1])
		ctx.lineTo(vertex[1][0], vertex[1][1])
		ctx.stroke();

		ctx.beginPath()
		ctx.moveTo(vertex[2][0], vertex[2][1])
		ctx.lineTo(vertex[3][0], vertex[3][1])
		ctx.stroke()

		ctx.strokeStyle = 'green';
		ctx.beginPath()
		ctx.lineTo(vertex[1][0], vertex[1][1])
		ctx.lineTo(vertex[2][0], vertex[2][1])
		ctx.stroke();

		ctx.beginPath()
		ctx.moveTo(vertex[3][0], vertex[3][1])
		ctx.lineTo(vertex[0][0], vertex[0][1])
		ctx.stroke();

		pos = marker.pos
		ctx.beginPath()
		ctx.arc(pos[0], pos[1], 8, 0, Math.PI * 2)
		ctx.fillStyle = 'red'
		ctx.fill()
	};


	
	ARController.getUserMedia = function(configuration) {
		var facing = configuration.facingMode || 'environment';

		var onSuccess = configuration.onSuccess;
		var onError = configuration.onError || function(err) { console.error("ARController.getUserMedia", err); };

		var video = document.createElement('video');

		var initProgress = function() {
			if (this.videoWidth !== 0) {
				onSuccess(video);
			}
		};

		var readyToPlay = false;
		var eventNames = [
			'touchstart', 'touchend', 'touchmove', 'touchcancel',
			'click', 'mousedown', 'mouseup', 'mousemove',
			'keydown', 'keyup', 'keypress', 'scroll'
		];
		var play = function(ev) {
			if (readyToPlay) {
				video.play();
				if (!video.paused) {
					eventNames.forEach(function(eventName) {
						window.removeEventListener(eventName, play, true);
					});
				}
			}
		};
		eventNames.forEach(function(eventName) {
			window.addEventListener(eventName, play, true);
		});

		var success = function(stream) {
			video.addEventListener('loadedmetadata', initProgress, false);
			video.src = window.URL.createObjectURL(stream);
			readyToPlay = true;
			play(); // Try playing without user input, should work on non-Android Chrome
		};

		var constraints = {};
		var mediaDevicesConstraints = {};
		if (configuration.width) {
			mediaDevicesConstraints.width = configuration.width;
			if (typeof configuration.width === 'object') {
				if (configuration.width.max) {
					constraints.maxWidth = configuration.width.max;
				}
				if (configuration.width.min) {
					constraints.minWidth = configuration.width.max;
				}
			} else {
				constraints.maxWidth = configuration.width;
			}
		}

		if (configuration.height) {
			mediaDevicesConstraints.height = configuration.height;
			if (typeof configuration.height === 'object') {
				if (configuration.height.max) {
					constraints.maxHeight = configuration.height.max;
				}
				if (configuration.height.min) {
					constraints.minHeight = configuration.height.max;
				}
			} else {
				constraints.maxHeight = configuration.height;
			}
		}

		mediaDevicesConstraints.facingMode = facing;

		navigator.getUserMedia  = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;
		var hdConstraints = {
			audio: false,
			video: {
				mandatory: constraints
		  	}
		};

		if ( false ) {
		// if ( navigator.mediaDevices || window.MediaStreamTrack) {
			if (navigator.mediaDevices) {
				navigator.mediaDevices.getUserMedia({
					audio: false,
					video: mediaDevicesConstraints
				}).then(success, onError); 
			} else {
				MediaStreamTrack.getSources(function(sources) {
					var facingDir = mediaDevicesConstraints.facingMode;
					if (facing && facing.exact) {
						facingDir = facing.exact;
					}
					for (var i=0; i<sources.length; i++) {
						if (sources[i].kind === 'video' && sources[i].facing === facingDir) {
							hdConstraints.video.mandatory.sourceId = sources[i].id;
							break;
						}
					}
					if (facing && facing.exact && !hdConstraints.video.mandatory.sourceId) {
						onError('Failed to get camera facing the wanted direction');
					} else {
						if (navigator.getUserMedia) {
							navigator.getUserMedia(hdConstraints, success, onError);
						} else {
							onError('navigator.getUserMedia is not supported on your browser');
						}
					}
				});
			}
		} else {
			if (navigator.getUserMedia) {
				navigator.getUserMedia(hdConstraints, success, onError);
			} else {
				onError('navigator.getUserMedia is not supported on your browser');
			}
		}

		return video;
	};


	ARController.getUserMediaARController = function(configuration) {
		var obj = {};
		for (var i in configuration) {
			obj[i] = configuration[i];
		}
		var onSuccess = configuration.onSuccess;
		var cameraParamURL = configuration.cameraParam;

		obj.onSuccess = function() {
			new ARCameraParam(cameraParamURL, function() {
				var arCameraParam = this;
				var maxSize = configuration.maxARVideoSize || Math.max(video.videoWidth, video.videoHeight);
				var f = maxSize / Math.max(video.videoWidth, video.videoHeight);
				var w = f * video.videoWidth;
				var h = f * video.videoHeight;
				if (video.videoWidth < video.videoHeight) {
					var tmp = w;
					w = h;
					h = tmp;
				}
				var arController = new ARController(w, h, arCameraParam);
				arController.image = video;
				if (video.videoWidth < video.videoHeight) {
					arController.orientation = 'portrait';
					arController.videoWidth = video.videoHeight;
					arController.videoHeight = video.videoWidth;
				} else {
					arController.orientation = 'landscape';
					arController.videoWidth = video.videoWidth;
					arController.videoHeight = video.videoHeight;
				}
				onSuccess(arController, arCameraParam);
			}, function(err) {
				console.error("ARController: Failed to load ARCameraParam", err);
			});
		};

		var video = this.getUserMedia(obj);
		return video;
	};



	var ARCameraParam = function(src, onload, onerror) {
		this.id = -1;
		this._src = '';
		this.complete = false;
		this.onload = onload;
		this.onerror = onerror;
		if (src) {
			this.load(src);
		}
	};


	ARCameraParam.prototype.load = function(src) {
		if (this._src !== '') {
			throw("ARCameraParam: Trying to load camera parameters twice.")
		}
		this._src = src;
		if (src) {
			var self = this;
			artoolkit.loadCamera(src, function(id) {
				self.id = id;
				self.complete = true;
				self.onload();
			}, function(err) {
				self.onerror(err);
			});
		}
	};

	Object.defineProperty(ARCameraParam.prototype, 'src', {
		set: function(src) {
			this.load(src);
		},
		get: function() {
			return this._src;
		}
	});


	ARCameraParam.prototype.dispose = function() {
		if (this.id !== -1) {
			artoolkit.deleteCamera(this.id);
		}
		this.id = -1;
		this._src = '';
		this.complete = false;
	};




	var artoolkit = {

		UNKNOWN_MARKER: -1,
		PATTERN_MARKER: 0,
		BARCODE_MARKER: 1,

		loadCamera: loadCamera,

		addMarker: addMarker,
		addMultiMarker: addMultiMarker,

	};

	var FUNCTIONS = [
		'setup',
		'teardown',

		'setLogLevel',
		'getLogLevel',

		'setDebugMode',
		'getDebugMode',

		'getProcessingImage',

		'setMarkerInfoDir',
		'setMarkerInfoVertex',

		'getTransMatSquare',
		'getTransMatSquareCont',

		'getTransMatMultiSquare',
		'getTransMatMultiSquareRobust',

		'getMultiMarkerNum',
		'getMultiMarkerCount',

		'detectMarker',
		'getMarkerNum',

		'getMarker',
		'getMultiEachMarker',

		'setProjectionNearPlane',
		'getProjectionNearPlane',

		'setProjectionFarPlane',
		'getProjectionFarPlane',

		'setThresholdMode',
		'getThresholdMode',

		'setThreshold',
		'getThreshold',

		'setPatternDetectionMode',
		'getPatternDetectionMode',

		'setMatrixCodeType',
		'getMatrixCodeType',

		'setLabelingMode',
		'getLabelingMode',

		'setPattRatio',
		'getPattRatio',

		'setImageProcMode',
		'getImageProcMode',
	];

	function runWhenLoaded() {
		FUNCTIONS.forEach(function(n) {
			artoolkit[n] = Module[n];
		})

		for (var m in Module) {
			if (m.match(/^AR/))
			artoolkit[m] = Module[m];
		}
	}

	var marker_count = 0;
	function addMarker(arId, url, callback) {
		var filename = '/marker_' + marker_count++;
		ajax(url, filename, function() {
			var id = Module._addMarker(arId, filename);
			if (callback) callback(id);
		});
	}

	function bytesToString(array) {
		return String.fromCharCode.apply(String, array);
	}

	function parseMultiFile(bytes) {
		var str = bytesToString(bytes);

		var lines = str.split('\n');

		var files = [];

		var state = 0; // 0 - read,
		var markers = 0;

		lines.forEach(function(line) {
			line = line.trim();
			if (!line || line.startsWith('#')) return;

			switch (state) {
				case 0:
					markers = +line;
					state = 1;
					return;
				case 1: // filename or barcode
					if (!line.match(/^\d+$/)) {
						files.push(line);
					}
				case 2: // width
				case 3: // matrices
				case 4:
					state++;
					return;
				case 5:
					state = 1;
					return;
			}
		});

		return files;
	}

	var multi_marker_count = 0;

	function addMultiMarker(arId, url, callback) {
		var filename = '/multi_marker_' + multi_marker_count++;
		ajax(url, filename, function(bytes) {
			var files = parseMultiFile(bytes);

			function ok() {
				var markerID = Module._addMultiMarker(arId, filename);
				var markerNum = Module.getMultiMarkerNum(arId, markerID);
				if (callback) callback(markerID, markerNum);
			}

			if (!files.length) return ok();

			var path = url.split('/').slice(0, -1).join('/')
			files = files.map(function(file) {
				// FIXME super kludge - remove it
				// console.assert(file !== '')
				if( file === 'patt.hiro' || file === 'patt.kanji' || file === 'patt2.hiro' || file === 'patt2.kanji' ){
					// debugger
					return ['http://127.0.0.1:8080/data/data/' + file, file]
				}
				return [path + '/' + file, file]
			})
			ajaxDependencies(files, ok);
		});
	}

	var camera_count = 0;
	function loadCamera(url, callback) {
		var filename = '/camera_param_' + camera_count++;
		var writeCallback = function() {
			var id = Module._loadCamera(filename);
			if (callback) callback(id);
		};
		if (typeof url === 'object') { // Maybe it's a byte array
			writeByteArrayToFS(filename, url, writeCallback);
		} else if (url.indexOf("\n") > -1) { // Or a string with the camera param
			writeStringToFS(filename, url, writeCallback);
		} else {
			ajax(url, filename, writeCallback);
		}
	}



	function writeStringToFS(target, string, callback) {
		var byteArray = new Uint8Array(string.length);
		for (var i=0; i<byteArray.length; i++) {
			byteArray[i] = string.charCodeAt(i) & 0xff;
		}
		writeByteArrayToFS(target, byteArray, callback);
	}

	function writeByteArrayToFS(target, byteArray, callback) {
		FS.writeFile(target, byteArray, { encoding: 'binary' });
		// console.log('FS written', target);

		callback(byteArray);
	}


	function ajax(url, target, callback) {
		var oReq = new XMLHttpRequest();
		oReq.open('GET', url, true);
		oReq.responseType = 'arraybuffer'; // blob arraybuffer

		oReq.onload = function(oEvent) {
			// console.log('ajax done for ', url);
			var arrayBuffer = oReq.response;
			var byteArray = new Uint8Array(arrayBuffer);
			writeByteArrayToFS(target, byteArray, callback);
		};

		oReq.send();
	}

	function ajaxDependencies(files, callback) {
		var next = files.pop();
		if (next) {
			ajax(next[0], next[1], function() {
				ajaxDependencies(files, callback);
			});
		} else {
			callback();
		}
	}

	window.artoolkit = artoolkit;
	window.ARController = ARController;
	window.ARCameraParam = ARCameraParam;

	if (window.Module) {
		runWhenLoaded();
	} else {
		window.Module = {
			onRuntimeInitialized: function() {
				runWhenLoaded();
			}
		};
	}

})();