(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */

var base64 = require('base64-js')
var ieee754 = require('ieee754')

exports.Buffer = Buffer
exports.SlowBuffer = Buffer
exports.INSPECT_MAX_BYTES = 50
Buffer.poolSize = 8192

/**
 * If `Buffer._useTypedArrays`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (compatible down to IE6)
 */
Buffer._useTypedArrays = (function () {
  // Detect if browser supports Typed Arrays. Supported browsers are IE 10+, Firefox 4+,
  // Chrome 7+, Safari 5.1+, Opera 11.6+, iOS 4.2+. If the browser does not support adding
  // properties to `Uint8Array` instances, then that's the same as no `Uint8Array` support
  // because we need to be able to add all the node Buffer API methods. This is an issue
  // in Firefox 4-29. Now fixed: https://bugzilla.mozilla.org/show_bug.cgi?id=695438
  try {
    var buf = new ArrayBuffer(0)
    var arr = new Uint8Array(buf)
    arr.foo = function () { return 42 }
    return 42 === arr.foo() &&
        typeof arr.subarray === 'function' // Chrome 9-10 lack `subarray`
  } catch (e) {
    return false
  }
})()

/**
 * Class: Buffer
 * =============
 *
 * The Buffer constructor returns instances of `Uint8Array` that are augmented
 * with function properties for all the node `Buffer` API functions. We use
 * `Uint8Array` so that square bracket notation works as expected -- it returns
 * a single octet.
 *
 * By augmenting the instances, we can avoid modifying the `Uint8Array`
 * prototype.
 */
function Buffer (subject, encoding, noZero) {
  if (!(this instanceof Buffer))
    return new Buffer(subject, encoding, noZero)

  var type = typeof subject

  // Workaround: node's base64 implementation allows for non-padded strings
  // while base64-js does not.
  if (encoding === 'base64' && type === 'string') {
    subject = stringtrim(subject)
    while (subject.length % 4 !== 0) {
      subject = subject + '='
    }
  }

  // Find the length
  var length
  if (type === 'number')
    length = coerce(subject)
  else if (type === 'string')
    length = Buffer.byteLength(subject, encoding)
  else if (type === 'object')
    length = coerce(subject.length) // assume that object is array-like
  else
    throw new Error('First argument needs to be a number, array or string.')

  var buf
  if (Buffer._useTypedArrays) {
    // Preferred: Return an augmented `Uint8Array` instance for best performance
    buf = Buffer._augment(new Uint8Array(length))
  } else {
    // Fallback: Return THIS instance of Buffer (created by `new`)
    buf = this
    buf.length = length
    buf._isBuffer = true
  }

  var i
  if (Buffer._useTypedArrays && typeof subject.byteLength === 'number') {
    // Speed optimization -- use set if we're copying from a typed array
    buf._set(subject)
  } else if (isArrayish(subject)) {
    // Treat array-ish objects as a byte array
    for (i = 0; i < length; i++) {
      if (Buffer.isBuffer(subject))
        buf[i] = subject.readUInt8(i)
      else
        buf[i] = subject[i]
    }
  } else if (type === 'string') {
    buf.write(subject, 0, encoding)
  } else if (type === 'number' && !Buffer._useTypedArrays && !noZero) {
    for (i = 0; i < length; i++) {
      buf[i] = 0
    }
  }

  return buf
}

// STATIC METHODS
// ==============

Buffer.isEncoding = function (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'raw':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.isBuffer = function (b) {
  return !!(b !== null && b !== undefined && b._isBuffer)
}

Buffer.byteLength = function (str, encoding) {
  var ret
  str = str + ''
  switch (encoding || 'utf8') {
    case 'hex':
      ret = str.length / 2
      break
    case 'utf8':
    case 'utf-8':
      ret = utf8ToBytes(str).length
      break
    case 'ascii':
    case 'binary':
    case 'raw':
      ret = str.length
      break
    case 'base64':
      ret = base64ToBytes(str).length
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = str.length * 2
      break
    default:
      throw new Error('Unknown encoding')
  }
  return ret
}

Buffer.concat = function (list, totalLength) {
  assert(isArray(list), 'Usage: Buffer.concat(list, [totalLength])\n' +
      'list should be an Array.')

  if (list.length === 0) {
    return new Buffer(0)
  } else if (list.length === 1) {
    return list[0]
  }

  var i
  if (typeof totalLength !== 'number') {
    totalLength = 0
    for (i = 0; i < list.length; i++) {
      totalLength += list[i].length
    }
  }

  var buf = new Buffer(totalLength)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

// BUFFER INSTANCE METHODS
// =======================

function _hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  assert(strLen % 2 === 0, 'Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; i++) {
    var byte = parseInt(string.substr(i * 2, 2), 16)
    assert(!isNaN(byte), 'Invalid hex string')
    buf[offset + i] = byte
  }
  Buffer._charsWritten = i * 2
  return i
}

function _utf8Write (buf, string, offset, length) {
  var charsWritten = Buffer._charsWritten =
    blitBuffer(utf8ToBytes(string), buf, offset, length)
  return charsWritten
}

function _asciiWrite (buf, string, offset, length) {
  var charsWritten = Buffer._charsWritten =
    blitBuffer(asciiToBytes(string), buf, offset, length)
  return charsWritten
}

function _binaryWrite (buf, string, offset, length) {
  return _asciiWrite(buf, string, offset, length)
}

function _base64Write (buf, string, offset, length) {
  var charsWritten = Buffer._charsWritten =
    blitBuffer(base64ToBytes(string), buf, offset, length)
  return charsWritten
}

function _utf16leWrite (buf, string, offset, length) {
  var charsWritten = Buffer._charsWritten =
    blitBuffer(utf16leToBytes(string), buf, offset, length)
  return charsWritten
}

Buffer.prototype.write = function (string, offset, length, encoding) {
  // Support both (string, offset, length, encoding)
  // and the legacy (string, encoding, offset, length)
  if (isFinite(offset)) {
    if (!isFinite(length)) {
      encoding = length
      length = undefined
    }
  } else {  // legacy
    var swap = encoding
    encoding = offset
    offset = length
    length = swap
  }

  offset = Number(offset) || 0
  var remaining = this.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }
  encoding = String(encoding || 'utf8').toLowerCase()

  var ret
  switch (encoding) {
    case 'hex':
      ret = _hexWrite(this, string, offset, length)
      break
    case 'utf8':
    case 'utf-8':
      ret = _utf8Write(this, string, offset, length)
      break
    case 'ascii':
      ret = _asciiWrite(this, string, offset, length)
      break
    case 'binary':
      ret = _binaryWrite(this, string, offset, length)
      break
    case 'base64':
      ret = _base64Write(this, string, offset, length)
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = _utf16leWrite(this, string, offset, length)
      break
    default:
      throw new Error('Unknown encoding')
  }
  return ret
}

Buffer.prototype.toString = function (encoding, start, end) {
  var self = this

  encoding = String(encoding || 'utf8').toLowerCase()
  start = Number(start) || 0
  end = (end !== undefined)
    ? Number(end)
    : end = self.length

  // Fastpath empty strings
  if (end === start)
    return ''

  var ret
  switch (encoding) {
    case 'hex':
      ret = _hexSlice(self, start, end)
      break
    case 'utf8':
    case 'utf-8':
      ret = _utf8Slice(self, start, end)
      break
    case 'ascii':
      ret = _asciiSlice(self, start, end)
      break
    case 'binary':
      ret = _binarySlice(self, start, end)
      break
    case 'base64':
      ret = _base64Slice(self, start, end)
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = _utf16leSlice(self, start, end)
      break
    default:
      throw new Error('Unknown encoding')
  }
  return ret
}

Buffer.prototype.toJSON = function () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function (target, target_start, start, end) {
  var source = this

  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (!target_start) target_start = 0

  // Copy 0 bytes; we're done
  if (end === start) return
  if (target.length === 0 || source.length === 0) return

  // Fatal error conditions
  assert(end >= start, 'sourceEnd < sourceStart')
  assert(target_start >= 0 && target_start < target.length,
      'targetStart out of bounds')
  assert(start >= 0 && start < source.length, 'sourceStart out of bounds')
  assert(end >= 0 && end <= source.length, 'sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length)
    end = this.length
  if (target.length - target_start < end - start)
    end = target.length - target_start + start

  var len = end - start

  if (len < 100 || !Buffer._useTypedArrays) {
    for (var i = 0; i < len; i++)
      target[i + target_start] = this[i + start]
  } else {
    target._set(this.subarray(start, start + len), target_start)
  }
}

function _base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function _utf8Slice (buf, start, end) {
  var res = ''
  var tmp = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    if (buf[i] <= 0x7F) {
      res += decodeUtf8Char(tmp) + String.fromCharCode(buf[i])
      tmp = ''
    } else {
      tmp += '%' + buf[i].toString(16)
    }
  }

  return res + decodeUtf8Char(tmp)
}

function _asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++)
    ret += String.fromCharCode(buf[i])
  return ret
}

function _binarySlice (buf, start, end) {
  return _asciiSlice(buf, start, end)
}

function _hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; i++) {
    out += toHex(buf[i])
  }
  return out
}

function _utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i+1] * 256)
  }
  return res
}

Buffer.prototype.slice = function (start, end) {
  var len = this.length
  start = clamp(start, len, 0)
  end = clamp(end, len, len)

  if (Buffer._useTypedArrays) {
    return Buffer._augment(this.subarray(start, end))
  } else {
    var sliceLen = end - start
    var newBuf = new Buffer(sliceLen, undefined, true)
    for (var i = 0; i < sliceLen; i++) {
      newBuf[i] = this[i + start]
    }
    return newBuf
  }
}

// `get` will be removed in Node 0.13+
Buffer.prototype.get = function (offset) {
  console.log('.get() is deprecated. Access using array indexes instead.')
  return this.readUInt8(offset)
}

// `set` will be removed in Node 0.13+
Buffer.prototype.set = function (v, offset) {
  console.log('.set() is deprecated. Access using array indexes instead.')
  return this.writeUInt8(v, offset)
}

Buffer.prototype.readUInt8 = function (offset, noAssert) {
  if (!noAssert) {
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset < this.length, 'Trying to read beyond buffer length')
  }

  if (offset >= this.length)
    return

  return this[offset]
}

function _readUInt16 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  var val
  if (littleEndian) {
    val = buf[offset]
    if (offset + 1 < len)
      val |= buf[offset + 1] << 8
  } else {
    val = buf[offset] << 8
    if (offset + 1 < len)
      val |= buf[offset + 1]
  }
  return val
}

Buffer.prototype.readUInt16LE = function (offset, noAssert) {
  return _readUInt16(this, offset, true, noAssert)
}

Buffer.prototype.readUInt16BE = function (offset, noAssert) {
  return _readUInt16(this, offset, false, noAssert)
}

function _readUInt32 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  var val
  if (littleEndian) {
    if (offset + 2 < len)
      val = buf[offset + 2] << 16
    if (offset + 1 < len)
      val |= buf[offset + 1] << 8
    val |= buf[offset]
    if (offset + 3 < len)
      val = val + (buf[offset + 3] << 24 >>> 0)
  } else {
    if (offset + 1 < len)
      val = buf[offset + 1] << 16
    if (offset + 2 < len)
      val |= buf[offset + 2] << 8
    if (offset + 3 < len)
      val |= buf[offset + 3]
    val = val + (buf[offset] << 24 >>> 0)
  }
  return val
}

Buffer.prototype.readUInt32LE = function (offset, noAssert) {
  return _readUInt32(this, offset, true, noAssert)
}

Buffer.prototype.readUInt32BE = function (offset, noAssert) {
  return _readUInt32(this, offset, false, noAssert)
}

Buffer.prototype.readInt8 = function (offset, noAssert) {
  if (!noAssert) {
    assert(offset !== undefined && offset !== null,
        'missing offset')
    assert(offset < this.length, 'Trying to read beyond buffer length')
  }

  if (offset >= this.length)
    return

  var neg = this[offset] & 0x80
  if (neg)
    return (0xff - this[offset] + 1) * -1
  else
    return this[offset]
}

function _readInt16 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  var val = _readUInt16(buf, offset, littleEndian, true)
  var neg = val & 0x8000
  if (neg)
    return (0xffff - val + 1) * -1
  else
    return val
}

Buffer.prototype.readInt16LE = function (offset, noAssert) {
  return _readInt16(this, offset, true, noAssert)
}

Buffer.prototype.readInt16BE = function (offset, noAssert) {
  return _readInt16(this, offset, false, noAssert)
}

function _readInt32 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  var val = _readUInt32(buf, offset, littleEndian, true)
  var neg = val & 0x80000000
  if (neg)
    return (0xffffffff - val + 1) * -1
  else
    return val
}

Buffer.prototype.readInt32LE = function (offset, noAssert) {
  return _readInt32(this, offset, true, noAssert)
}

Buffer.prototype.readInt32BE = function (offset, noAssert) {
  return _readInt32(this, offset, false, noAssert)
}

function _readFloat (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset + 3 < buf.length, 'Trying to read beyond buffer length')
  }

  return ieee754.read(buf, offset, littleEndian, 23, 4)
}

Buffer.prototype.readFloatLE = function (offset, noAssert) {
  return _readFloat(this, offset, true, noAssert)
}

Buffer.prototype.readFloatBE = function (offset, noAssert) {
  return _readFloat(this, offset, false, noAssert)
}

function _readDouble (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset + 7 < buf.length, 'Trying to read beyond buffer length')
  }

  return ieee754.read(buf, offset, littleEndian, 52, 8)
}

Buffer.prototype.readDoubleLE = function (offset, noAssert) {
  return _readDouble(this, offset, true, noAssert)
}

Buffer.prototype.readDoubleBE = function (offset, noAssert) {
  return _readDouble(this, offset, false, noAssert)
}

Buffer.prototype.writeUInt8 = function (value, offset, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset < this.length, 'trying to write beyond buffer length')
    verifuint(value, 0xff)
  }

  if (offset >= this.length) return

  this[offset] = value
}

function _writeUInt16 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'trying to write beyond buffer length')
    verifuint(value, 0xffff)
  }

  var len = buf.length
  if (offset >= len)
    return

  for (var i = 0, j = Math.min(len - offset, 2); i < j; i++) {
    buf[offset + i] =
        (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
            (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function (value, offset, noAssert) {
  _writeUInt16(this, value, offset, true, noAssert)
}

Buffer.prototype.writeUInt16BE = function (value, offset, noAssert) {
  _writeUInt16(this, value, offset, false, noAssert)
}

function _writeUInt32 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'trying to write beyond buffer length')
    verifuint(value, 0xffffffff)
  }

  var len = buf.length
  if (offset >= len)
    return

  for (var i = 0, j = Math.min(len - offset, 4); i < j; i++) {
    buf[offset + i] =
        (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function (value, offset, noAssert) {
  _writeUInt32(this, value, offset, true, noAssert)
}

Buffer.prototype.writeUInt32BE = function (value, offset, noAssert) {
  _writeUInt32(this, value, offset, false, noAssert)
}

Buffer.prototype.writeInt8 = function (value, offset, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset < this.length, 'Trying to write beyond buffer length')
    verifsint(value, 0x7f, -0x80)
  }

  if (offset >= this.length)
    return

  if (value >= 0)
    this.writeUInt8(value, offset, noAssert)
  else
    this.writeUInt8(0xff + value + 1, offset, noAssert)
}

function _writeInt16 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'Trying to write beyond buffer length')
    verifsint(value, 0x7fff, -0x8000)
  }

  var len = buf.length
  if (offset >= len)
    return

  if (value >= 0)
    _writeUInt16(buf, value, offset, littleEndian, noAssert)
  else
    _writeUInt16(buf, 0xffff + value + 1, offset, littleEndian, noAssert)
}

Buffer.prototype.writeInt16LE = function (value, offset, noAssert) {
  _writeInt16(this, value, offset, true, noAssert)
}

Buffer.prototype.writeInt16BE = function (value, offset, noAssert) {
  _writeInt16(this, value, offset, false, noAssert)
}

function _writeInt32 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to write beyond buffer length')
    verifsint(value, 0x7fffffff, -0x80000000)
  }

  var len = buf.length
  if (offset >= len)
    return

  if (value >= 0)
    _writeUInt32(buf, value, offset, littleEndian, noAssert)
  else
    _writeUInt32(buf, 0xffffffff + value + 1, offset, littleEndian, noAssert)
}

Buffer.prototype.writeInt32LE = function (value, offset, noAssert) {
  _writeInt32(this, value, offset, true, noAssert)
}

Buffer.prototype.writeInt32BE = function (value, offset, noAssert) {
  _writeInt32(this, value, offset, false, noAssert)
}

function _writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to write beyond buffer length')
    verifIEEE754(value, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }

  var len = buf.length
  if (offset >= len)
    return

  ieee754.write(buf, value, offset, littleEndian, 23, 4)
}

Buffer.prototype.writeFloatLE = function (value, offset, noAssert) {
  _writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function (value, offset, noAssert) {
  _writeFloat(this, value, offset, false, noAssert)
}

function _writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 7 < buf.length,
        'Trying to write beyond buffer length')
    verifIEEE754(value, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }

  var len = buf.length
  if (offset >= len)
    return

  ieee754.write(buf, value, offset, littleEndian, 52, 8)
}

Buffer.prototype.writeDoubleLE = function (value, offset, noAssert) {
  _writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function (value, offset, noAssert) {
  _writeDouble(this, value, offset, false, noAssert)
}

// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function (value, start, end) {
  if (!value) value = 0
  if (!start) start = 0
  if (!end) end = this.length

  if (typeof value === 'string') {
    value = value.charCodeAt(0)
  }

  assert(typeof value === 'number' && !isNaN(value), 'value is not a number')
  assert(end >= start, 'end < start')

  // Fill 0 bytes; we're done
  if (end === start) return
  if (this.length === 0) return

  assert(start >= 0 && start < this.length, 'start out of bounds')
  assert(end >= 0 && end <= this.length, 'end out of bounds')

  for (var i = start; i < end; i++) {
    this[i] = value
  }
}

Buffer.prototype.inspect = function () {
  var out = []
  var len = this.length
  for (var i = 0; i < len; i++) {
    out[i] = toHex(this[i])
    if (i === exports.INSPECT_MAX_BYTES) {
      out[i + 1] = '...'
      break
    }
  }
  return '<Buffer ' + out.join(' ') + '>'
}

/**
 * Creates a new `ArrayBuffer` with the *copied* memory of the buffer instance.
 * Added in Node 0.12. Only available in browsers that support ArrayBuffer.
 */
Buffer.prototype.toArrayBuffer = function () {
  if (typeof Uint8Array !== 'undefined') {
    if (Buffer._useTypedArrays) {
      return (new Buffer(this)).buffer
    } else {
      var buf = new Uint8Array(this.length)
      for (var i = 0, len = buf.length; i < len; i += 1)
        buf[i] = this[i]
      return buf.buffer
    }
  } else {
    throw new Error('Buffer.toArrayBuffer not supported in this browser')
  }
}

// HELPER FUNCTIONS
// ================

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

var BP = Buffer.prototype

/**
 * Augment a Uint8Array *instance* (not the Uint8Array class!) with Buffer methods
 */
Buffer._augment = function (arr) {
  arr._isBuffer = true

  // save reference to original Uint8Array get/set methods before overwriting
  arr._get = arr.get
  arr._set = arr.set

  // deprecated, will be removed in node 0.13+
  arr.get = BP.get
  arr.set = BP.set

  arr.write = BP.write
  arr.toString = BP.toString
  arr.toLocaleString = BP.toString
  arr.toJSON = BP.toJSON
  arr.copy = BP.copy
  arr.slice = BP.slice
  arr.readUInt8 = BP.readUInt8
  arr.readUInt16LE = BP.readUInt16LE
  arr.readUInt16BE = BP.readUInt16BE
  arr.readUInt32LE = BP.readUInt32LE
  arr.readUInt32BE = BP.readUInt32BE
  arr.readInt8 = BP.readInt8
  arr.readInt16LE = BP.readInt16LE
  arr.readInt16BE = BP.readInt16BE
  arr.readInt32LE = BP.readInt32LE
  arr.readInt32BE = BP.readInt32BE
  arr.readFloatLE = BP.readFloatLE
  arr.readFloatBE = BP.readFloatBE
  arr.readDoubleLE = BP.readDoubleLE
  arr.readDoubleBE = BP.readDoubleBE
  arr.writeUInt8 = BP.writeUInt8
  arr.writeUInt16LE = BP.writeUInt16LE
  arr.writeUInt16BE = BP.writeUInt16BE
  arr.writeUInt32LE = BP.writeUInt32LE
  arr.writeUInt32BE = BP.writeUInt32BE
  arr.writeInt8 = BP.writeInt8
  arr.writeInt16LE = BP.writeInt16LE
  arr.writeInt16BE = BP.writeInt16BE
  arr.writeInt32LE = BP.writeInt32LE
  arr.writeInt32BE = BP.writeInt32BE
  arr.writeFloatLE = BP.writeFloatLE
  arr.writeFloatBE = BP.writeFloatBE
  arr.writeDoubleLE = BP.writeDoubleLE
  arr.writeDoubleBE = BP.writeDoubleBE
  arr.fill = BP.fill
  arr.inspect = BP.inspect
  arr.toArrayBuffer = BP.toArrayBuffer

  return arr
}

// slice(start, end)
function clamp (index, len, defaultValue) {
  if (typeof index !== 'number') return defaultValue
  index = ~~index;  // Coerce to integer.
  if (index >= len) return len
  if (index >= 0) return index
  index += len
  if (index >= 0) return index
  return 0
}

function coerce (length) {
  // Coerce length to a number (possibly NaN), round up
  // in case it's fractional (e.g. 123.456) then do a
  // double negate to coerce a NaN to 0. Easy, right?
  length = ~~Math.ceil(+length)
  return length < 0 ? 0 : length
}

function isArray (subject) {
  return (Array.isArray || function (subject) {
    return Object.prototype.toString.call(subject) === '[object Array]'
  })(subject)
}

function isArrayish (subject) {
  return isArray(subject) || Buffer.isBuffer(subject) ||
      subject && typeof subject === 'object' &&
      typeof subject.length === 'number'
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    var b = str.charCodeAt(i)
    if (b <= 0x7F)
      byteArray.push(str.charCodeAt(i))
    else {
      var start = i
      if (b >= 0xD800 && b <= 0xDFFF) i++
      var h = encodeURIComponent(str.slice(start, i+1)).substr(1).split('%')
      for (var j = 0; j < h.length; j++)
        byteArray.push(parseInt(h[j], 16))
    }
  }
  return byteArray
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(str)
}

function blitBuffer (src, dst, offset, length) {
  var pos
  for (var i = 0; i < length; i++) {
    if ((i + offset >= dst.length) || (i >= src.length))
      break
    dst[i + offset] = src[i]
  }
  return i
}

function decodeUtf8Char (str) {
  try {
    return decodeURIComponent(str)
  } catch (err) {
    return String.fromCharCode(0xFFFD) // UTF 8 invalid char
  }
}

/*
 * We have to make sure that the value is a valid integer. This means that it
 * is non-negative. It has no fractional component and that it does not
 * exceed the maximum allowed value.
 */
function verifuint (value, max) {
  assert(typeof value === 'number', 'cannot write a non-number as a number')
  assert(value >= 0, 'specified a negative value for writing an unsigned value')
  assert(value <= max, 'value is larger than maximum value for type')
  assert(Math.floor(value) === value, 'value has a fractional component')
}

function verifsint (value, max, min) {
  assert(typeof value === 'number', 'cannot write a non-number as a number')
  assert(value <= max, 'value larger than maximum allowed value')
  assert(value >= min, 'value smaller than minimum allowed value')
  assert(Math.floor(value) === value, 'value has a fractional component')
}

function verifIEEE754 (value, max, min) {
  assert(typeof value === 'number', 'cannot write a non-number as a number')
  assert(value <= max, 'value larger than maximum allowed value')
  assert(value >= min, 'value smaller than minimum allowed value')
}

function assert (test, message) {
  if (!test) throw new Error(message || 'Failed assertion')
}

}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../../../node_modules/gulp-browserify/node_modules/browserify/node_modules/buffer/index.js","/../../../node_modules/gulp-browserify/node_modules/browserify/node_modules/buffer")
},{"+7ZJp0":4,"base64-js":2,"buffer":1,"ieee754":3}],2:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

;(function (exports) {
	'use strict';

  var Arr = (typeof Uint8Array !== 'undefined')
    ? Uint8Array
    : Array

	var PLUS   = '+'.charCodeAt(0)
	var SLASH  = '/'.charCodeAt(0)
	var NUMBER = '0'.charCodeAt(0)
	var LOWER  = 'a'.charCodeAt(0)
	var UPPER  = 'A'.charCodeAt(0)

	function decode (elt) {
		var code = elt.charCodeAt(0)
		if (code === PLUS)
			return 62 // '+'
		if (code === SLASH)
			return 63 // '/'
		if (code < NUMBER)
			return -1 //no match
		if (code < NUMBER + 10)
			return code - NUMBER + 26 + 26
		if (code < UPPER + 26)
			return code - UPPER
		if (code < LOWER + 26)
			return code - LOWER + 26
	}

	function b64ToByteArray (b64) {
		var i, j, l, tmp, placeHolders, arr

		if (b64.length % 4 > 0) {
			throw new Error('Invalid string. Length must be a multiple of 4')
		}

		// the number of equal signs (place holders)
		// if there are two placeholders, than the two characters before it
		// represent one byte
		// if there is only one, then the three characters before it represent 2 bytes
		// this is just a cheap hack to not do indexOf twice
		var len = b64.length
		placeHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0

		// base64 is 4/3 + up to two characters of the original data
		arr = new Arr(b64.length * 3 / 4 - placeHolders)

		// if there are placeholders, only get up to the last complete 4 chars
		l = placeHolders > 0 ? b64.length - 4 : b64.length

		var L = 0

		function push (v) {
			arr[L++] = v
		}

		for (i = 0, j = 0; i < l; i += 4, j += 3) {
			tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3))
			push((tmp & 0xFF0000) >> 16)
			push((tmp & 0xFF00) >> 8)
			push(tmp & 0xFF)
		}

		if (placeHolders === 2) {
			tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4)
			push(tmp & 0xFF)
		} else if (placeHolders === 1) {
			tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2)
			push((tmp >> 8) & 0xFF)
			push(tmp & 0xFF)
		}

		return arr
	}

	function uint8ToBase64 (uint8) {
		var i,
			extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
			output = "",
			temp, length

		function encode (num) {
			return lookup.charAt(num)
		}

		function tripletToBase64 (num) {
			return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F)
		}

		// go through the array every three bytes, we'll deal with trailing stuff later
		for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
			output += tripletToBase64(temp)
		}

		// pad the end with zeros, but make sure to not forget the extra bytes
		switch (extraBytes) {
			case 1:
				temp = uint8[uint8.length - 1]
				output += encode(temp >> 2)
				output += encode((temp << 4) & 0x3F)
				output += '=='
				break
			case 2:
				temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1])
				output += encode(temp >> 10)
				output += encode((temp >> 4) & 0x3F)
				output += encode((temp << 2) & 0x3F)
				output += '='
				break
		}

		return output
	}

	exports.toByteArray = b64ToByteArray
	exports.fromByteArray = uint8ToBase64
}(typeof exports === 'undefined' ? (this.base64js = {}) : exports))

}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../../../node_modules/gulp-browserify/node_modules/browserify/node_modules/buffer/node_modules/base64-js/lib/b64.js","/../../../node_modules/gulp-browserify/node_modules/browserify/node_modules/buffer/node_modules/base64-js/lib")
},{"+7ZJp0":4,"buffer":1}],3:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
exports.read = function(buffer, offset, isLE, mLen, nBytes) {
  var e, m,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      nBits = -7,
      i = isLE ? (nBytes - 1) : 0,
      d = isLE ? -1 : 1,
      s = buffer[offset + i];

  i += d;

  e = s & ((1 << (-nBits)) - 1);
  s >>= (-nBits);
  nBits += eLen;
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8);

  m = e & ((1 << (-nBits)) - 1);
  e >>= (-nBits);
  nBits += mLen;
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8);

  if (e === 0) {
    e = 1 - eBias;
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity);
  } else {
    m = m + Math.pow(2, mLen);
    e = e - eBias;
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
};

exports.write = function(buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0),
      i = isLE ? 0 : (nBytes - 1),
      d = isLE ? 1 : -1,
      s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0;

  value = Math.abs(value);

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0;
    e = eMax;
  } else {
    e = Math.floor(Math.log(value) / Math.LN2);
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--;
      c *= 2;
    }
    if (e + eBias >= 1) {
      value += rt / c;
    } else {
      value += rt * Math.pow(2, 1 - eBias);
    }
    if (value * c >= 2) {
      e++;
      c /= 2;
    }

    if (e + eBias >= eMax) {
      m = 0;
      e = eMax;
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen);
      e = e + eBias;
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
      e = 0;
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8);

  e = (e << mLen) | m;
  eLen += mLen;
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8);

  buffer[offset + i - d] |= s * 128;
};

}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../../../node_modules/gulp-browserify/node_modules/browserify/node_modules/buffer/node_modules/ieee754/index.js","/../../../node_modules/gulp-browserify/node_modules/browserify/node_modules/buffer/node_modules/ieee754")
},{"+7ZJp0":4,"buffer":1}],4:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
// shim for using process in browser

var process = module.exports = {};

process.nextTick = (function () {
    var canSetImmediate = typeof window !== 'undefined'
    && window.setImmediate;
    var canPost = typeof window !== 'undefined'
    && window.postMessage && window.addEventListener
    ;

    if (canSetImmediate) {
        return function (f) { return window.setImmediate(f) };
    }

    if (canPost) {
        var queue = [];
        window.addEventListener('message', function (ev) {
            var source = ev.source;
            if ((source === window || source === null) && ev.data === 'process-tick') {
                ev.stopPropagation();
                if (queue.length > 0) {
                    var fn = queue.shift();
                    fn();
                }
            }
        }, true);

        return function nextTick(fn) {
            queue.push(fn);
            window.postMessage('process-tick', '*');
        };
    }

    return function nextTick(fn) {
        setTimeout(fn, 0);
    };
})();

process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
}

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};

}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../../../node_modules/gulp-browserify/node_modules/browserify/node_modules/process/browser.js","/../../../node_modules/gulp-browserify/node_modules/browserify/node_modules/process")
},{"+7ZJp0":4,"buffer":1}],5:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
module.exports = angular.module('app.config', []);
//require('./config.js');
require('./routes.js');

}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../config/_module_init.js","/../config")
},{"+7ZJp0":4,"./routes.js":6,"buffer":1}],6:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var module = require('./_module_init.js');
module.config(function($stateProvider, $urlRouterProvider, $httpProvider) {
	delete $httpProvider.defaults.headers.common['X-Requested-With'];
	$urlRouterProvider.otherwise('/home'); //DEFAULT
});

module.run([
	'$QJHelperFunctions', '$QJLogger', '$QJApi', '$rootScope', '$location', '$urlRouter', '$state', '$timeout',
	function($QJHelperFunctions, $QJLogger, $QJApi, $rootScope, $location, $urlRouter, $state, $timeout) {

		$rootScope.$on('$stateChangeStart', function(event, toState, toParams, fromState, fromParams) {
			//
			var logged = $rootScope.session.token != null;
			if (toState.name != "login" && !logged) {
				$QJLogger.log('run -> state -> force redirection');
				event.preventDefault();
				$QJHelperFunctions.changeState('login');
			}
			//
		});

	}
]);

module.config(function($stateProvider, $urlRouterProvider, $httpProvider) {

console.info('[ROUTES]');

	$stateProvider
	.state('home', {
		url: '^/home',
		views: {
			'': {
				templateUrl: 'pages/home.html',
				controller: 'HomeController'
			},
			'nav': {
				templateUrl: 'pages/nav.html',
				controller: 'NavController'
			},
			'sidebar': {
				templateUrl: 'pages/sidebar.html',
				controller: 'SidebarController'
			}
		}
	})

	.state('login', {
		url: '^/login',
		views: {
			'': {
				templateUrl: 'pages/login.html',
				controller: 'LoginController'
			},
			'nav': {
				templateUrl: 'pages/empty_nav.html'
			},
			'sidebar': {
				templateUrl: 'pages/empty.html'
			}
		}
	})



	.state('error-response-has-errors', {
		url: '^/apierrorinvalidresponse',
		views: {
			'': {
				templateUrl: 'pages/errors/api.response.has.errors.html'
			},
			'nav': {
				templateUrl: 'pages/empty_nav.html'
			},
			'sidebar': {
				templateUrl: 'pages/empty.html'
			}
		}
	})

	.state('error-invalid-response', {
		url: '^/apierrorinvalidresponse',
		views: {
			'': {
				templateUrl: 'pages/errors/api.invalid.response.html'
			},
			'nav': {
				templateUrl: 'pages/empty_nav.html'
			},
			'sidebar': {
				templateUrl: 'pages/empty.html'
			}
		}
	})

	.state('error-api', {
		url: '^/apierror',
		views: {
			'': {
				templateUrl: 'pages/errors/api.html'
			},
			'nav': {
				templateUrl: 'pages/empty_nav.html'
			},
			'sidebar': {
				templateUrl: 'pages/empty.html'
			}
		}
	})


	//MENUS
	.state('module-menu-list', {
		url: '^/menus',
		views: {
			'': {
				templateUrl: 'pages/menu/menu.list.html',
				controller: 'MenuListController'
			},
			'nav': {
				templateUrl: 'pages/nav.html',
				controller: 'NavController'
			},
			'sidebar': {
				templateUrl: 'pages/sidebar.html',
				controller: 'SidebarController'
			}
		}
	})
		.state('module-menu-edit', {
			url: '^/menu/:id',
			views: {
				'': {
					templateUrl: 'pages/menu/menu.edit.html',
					controller: 'MenuEditController'
				},
				'nav': {
					templateUrl: 'pages/nav.html',
					controller: 'NavController'
				},
				'sidebar': {
					templateUrl: 'pages/sidebar.html',
					controller: 'SidebarController'
				}
			}
		})


	.state('module-profile-list', {
		url: '^/profiles',
		views: {
			'': {
				templateUrl: 'pages/profile/profile.list.html',
				controller: 'ProfileListController'
			},
			'nav': {
				templateUrl: 'pages/nav.html',
				controller: 'NavController'
			},
			'sidebar': {
				templateUrl: 'pages/sidebar.html',
				controller: 'SidebarController'
			}
		}
	})
		.state('module-profile-edit', {
			url: '^/profiles/:id',
			views: {
				'': {
					templateUrl: 'pages/profile/profile.edit.html',
					controller: 'ProfileEditController'
				},
				'nav': {
					templateUrl: 'pages/nav.html',
					controller: 'NavController'
				},
				'sidebar': {
					templateUrl: 'pages/sidebar.html',
					controller: 'SidebarController'
				}
			}
		})

	.state('module-usergroup-list', {
		url: '^/usergroups',
		views: {
			'': {
				templateUrl: 'pages/users/usergroup.list.html',
				controller: 'UsergroupListController'
			},
			'nav': {
				templateUrl: 'pages/nav.html',
				controller: 'NavController'
			},
			'sidebar': {
				templateUrl: 'pages/sidebar.html',
				controller: 'SidebarController'
			}
		}
	})
		.state('module-usergroup-edit', {
			url: '^/usergroups/:id',
			views: {
				'': {
					templateUrl: 'pages/users/usergroup.edit.html',
					controller: 'UsergroupEditController'
				},
				'nav': {
					templateUrl: 'pages/nav.html',
					controller: 'NavController'
				},
				'sidebar': {
					templateUrl: 'pages/sidebar.html',
					controller: 'SidebarController'
				}
			}
		})



	.state('module-user-list', {
		url: '^/users',
		views: {
			'': {
				templateUrl: 'pages/users/users.list.html',
				controller: 'UserListController'
			},
			'nav': {
				templateUrl: 'pages/nav.html',
				controller: 'NavController'
			},
			'sidebar': {
				templateUrl: 'pages/sidebar.html',
				controller: 'SidebarController'
			}
		}
	})
		.state('module-user-edit', {
			url: '^/user/:id',
			views: {
				'': {
					templateUrl: 'pages/users/users.edit.html',
					controller: 'UserEditController'
				},
				'nav': {
					templateUrl: 'pages/nav.html',
					controller: 'NavController'
				},
				'sidebar': {
					templateUrl: 'pages/sidebar.html',
					controller: 'SidebarController'
				}
			}
		})

	.state('module-user-myprofile-edit', {
		url: '^/myprofile/:id',
		views: {
			'': {
				templateUrl: 'pages/users/users.myprofile.edit.html',
				controller: 'UserEditController'
			},
			'nav': {
				templateUrl: 'pages/nav.html',
				controller: 'NavController'
			},
			'sidebar': {
				templateUrl: 'pages/sidebar.html',
				controller: 'SidebarController'
			}
		}
	})

	.state('module-project-list', {
		url: '^/project',
		views: {
			'': {
				templateUrl: 'pages/project/project.list.html',
				controller: 'ProjectListController'
			},
			'nav': {
				templateUrl: 'pages/nav.html',
				controller: 'NavController'
			},
			'sidebar': {
				templateUrl: 'pages/sidebar.html',
				controller: 'SidebarController'
			}
		}
	})
		.state('module-project-edit', {
			url: '^/project/:id',
			views: {
				'': {
					templateUrl: 'pages/project/project.edit.html',
					controller: 'ProjectEditController'
				},
				'nav': {
					templateUrl: 'pages/nav.html',
					controller: 'NavController'
				},
				'sidebar': {
					templateUrl: 'pages/sidebar.html',
					controller: 'SidebarController'
				}
			}
		})

	.state('module-project-hours-list', {
		url: '^/projecthours',
		views: {
			'': {
				templateUrl: 'pages/project/project.hours.list.html',
				controller: 'ProjectHoursListController'
			},
			'nav': {
				templateUrl: 'pages/nav.html',
				controller: 'NavController'
			},
			'sidebar': {
				templateUrl: 'pages/sidebar.html',
				controller: 'SidebarController'
			}
		}
	})
		.state('module-project-hours-edit', {
			url: '^/projecthours/:id',
			views: {
				'': {
					templateUrl: 'pages/project/project.hours.edit.html',
					controller: 'ProjectHoursEditController'
				},
				'nav': {
					templateUrl: 'pages/nav.html',
					controller: 'NavController'
				},
				'sidebar': {
					templateUrl: 'pages/sidebar.html',
					controller: 'SidebarController'
				}
			}
		})


	.state('module-settings', {
		url: '^/settings',
		views: {
			'': {
				templateUrl: 'pages/settings/qj.settings.html',
				controller: 'QJBackendSettingsController'
			},
			'nav': {
				templateUrl: 'pages/nav.html',
				controller: 'NavController'
			},
			'sidebar': {
				templateUrl: 'pages/sidebar.html',
				controller: 'SidebarController'
			}
		}
	})


	.state('module-vipster-settings', {
		url: '^/vipster/settings',
		views: {
			'': {
				templateUrl: 'pages/vipster/vipster.settings.html',
				controller: 'VipsterConfigController'
			},
			'nav': {
				templateUrl: 'pages/nav.html',
				controller: 'NavController'
			},
			'sidebar': {
				templateUrl: 'pages/sidebar.html',
				controller: 'SidebarController'
			}
		}
	})

	.state('module-chat', {
		url: '^/chat',
		views: {
			'': {
				templateUrl: 'pages/chat/chat.main.html',
				controller: 'ChatController'
			},
			'nav': {
				templateUrl: 'pages/nav.html',
				controller: 'NavController'
			},
			'sidebar': {
				templateUrl: 'pages/sidebar.html',
				controller: 'SidebarController'
			}
		}
	})



	;
});
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../config/routes.js","/../config")
},{"+7ZJp0":4,"./_module_init.js":5,"buffer":1}],7:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
module.exports = angular.module('app.controllers', []);
require('./appCtrl.js');
require('./chatCtrl.js');
require('./homeCtrl.js');
require('./loginCtrl.js');
require('./mod.menuCtrl.js');
require('./mod.profileCtrl.js');
require('./mod.projecthoursCtrl.js');
require('./mod.projectsCtrl.js');
require('./mod.usergroupCtrl.js');
require('./mod.usersCtrl.js');
require('./navCtrl.js');
require('./settingsCtrl.js');
require('./sidebarCtrl.js');
require('./vp.configCtrl.js');
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../controllers/_module_init.js","/../controllers")
},{"+7ZJp0":4,"./appCtrl.js":8,"./chatCtrl.js":9,"./homeCtrl.js":10,"./loginCtrl.js":11,"./mod.menuCtrl.js":12,"./mod.profileCtrl.js":13,"./mod.projecthoursCtrl.js":14,"./mod.projectsCtrl.js":15,"./mod.usergroupCtrl.js":16,"./mod.usersCtrl.js":17,"./navCtrl.js":18,"./settingsCtrl.js":19,"./sidebarCtrl.js":20,"./vp.configCtrl.js":21,"buffer":1}],8:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var module = require('./_module_init.js');
module.controller('AppController', function(
	$QJLogger, $QJHelperFunctions, $scope, $rootScope, $QJLoginModule, $QJApi, $timeout, $state, $QJLoginModule
) {
	$QJLogger.log("AppController -> initialized");
	//$QJHelperFunctions.checkAPIAndGoToApiErrorStateIfThereIsAProblem();
	$QJHelperFunctions.checkTokenExpirationAndGoToLoginStateIfHasExpired();
});
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../controllers/appCtrl.js","/../controllers")
},{"+7ZJp0":4,"./_module_init.js":7,"buffer":1}],9:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var module = require('./_module_init.js');
module.controller('ChatController', function(
	$QJCCombobox, $QJCSelectkey, $QJCListview, $QJCFilter, $QJLogger, $QJHelperFunctions, $scope, $rootScope, $QJLoginModule, $QJApi, $timeout, $state, $QJLoginModule
) {
	$QJLogger.log("ChatController -> initialized");


	$scope.breadcrumb = {
		name: 'Chat',
		list: [
			//{name:'None2',state:'',fa:'fa-dashboard'}
		],
		active: "Chat"
	};


	$scope.input = "";
	$scope.items = [{
		sender: "Pepe",
		message: "Blabla"
	}, {
		sender: "Pepe 2",
		message: "Blabla"
	}];



	/*
		var obj = JSON.parse(e.data);
		console.info(obj);
		$timeout(function(){
			$scope.$apply(function(){
				$scope.items.push(obj);
			});
		});
	*/


	$scope.enter = function() {
		var newItem = {
			loginname: $rootScope.session.loginname,
			message: $scope.input
		};
		$scope.items.unshift(newItem);
		$scope.input = "";
		//
		$QJApi.getController('chat').post({
			action: 'save'
		}, {
			message: newItem.message,
			_chat_id: 1
		}, function(res) {
			$QJLogger.log("ChatController -> POST chat save -> success");
			update();
		});
	};



	function update() {
		$QJApi.getController('chat').get({
			action: 'list'
		}, function(res) {
			$QJLogger.log("ChatController -> GET chat list -> success");
			$scope.items = _.sortBy(res.items, function(item) {
				return item._id * -1;
			});
			console.info(res.items);
		});
	}
	update();

	var myVar = setInterval(update, 5000);

	$rootScope.$on('$stateChangeStart',
		function(event, toState, toParams, fromState, fromParams) {

			if (fromState.name === "module-chat") {
				clearInterval(myVar);
			}

		});

})

}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../controllers/chatCtrl.js","/../controllers")
},{"+7ZJp0":4,"./_module_init.js":7,"buffer":1}],10:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var module = require('./_module_init.js');
module.controller('HomeController', function(
	$QJAuth, $QJCCombobox, $QJLogger, $scope, $rootScope, $QJLoginModule, $QJLocalSession, $QJConfig, $QJApi) {
	$QJLogger.log("HomeController -> initialized");

	$scope.breadcrumb = {
		name: 'Dashboard',
		list: [
			//{name:"None1",state:'module-project-list',fa:'fa-dashboard'},
			//{name:'None2',state:'',fa:'fa-dashboard'}
		],
		active: "Dashboard"
	};


});
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../controllers/homeCtrl.js","/../controllers")
},{"+7ZJp0":4,"./_module_init.js":7,"buffer":1}],11:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var module = require('./_module_init.js');
module.controller('LoginController', function(
    $QJLogger,
    $scope, $rootScope, $QJLoginModule, $timeout, $QJHelperFunctions) {
    $QJLogger.log('LoginController');

    $scope.loginnameRequired = false;
    $scope.passwordRequired = false;

    setTimeout(function() {
        $rootScope.error = {
            message: ""
        };
    }, 4000);


    $scope.classForPassword = function() {
        return 'form-group ' + ($scope.passwordRequired ? 'has-error' : '');
    };

    $scope.invalidCredentials = function() {
        console.info("[QJarvisAppLoginController]->[InvalidCredentials]");
        $scope.showError("Credenciales invalidas");
    };

    $scope.showError = function(errorMessage) {
        $rootScope.error = {
            message: errorMessage
        };
        setTimeout(function() {
            $rootScope.message = '';
        }, 5000);
    };

    $scope.validateFields = function(success) {
        if (_.isUndefined($scope.loginname) || $scope.loginname == "") {
            console.info("[]->[loginname required]");
            $scope.showError("Usuario requerido");
        } else {
            if (_.isUndefined($scope.password) || $scope.password == "") {
                console.info("[]->[password required]");
                $scope.showError("Password requerida");
            } else {
                success();
            }
        }
    };

    $scope.submit = function() {
        $scope.validateFields(function() {
            $QJLoginModule.login($scope.loginname, $scope.password, function() {
                $QJHelperFunctions.changeState('home');
            });
        });
    };
});
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../controllers/loginCtrl.js","/../controllers")
},{"+7ZJp0":4,"./_module_init.js":7,"buffer":1}],12:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var module = require('./_module_init.js');
module.controller('MenuListController', function(
    $QJCCombobox, $QJCSelectkey, $QJCListview, $QJCFilter, $QJLogger, $QJHelperFunctions, $scope, $rootScope, $QJLoginModule, $QJApi, $timeout, $state, $QJLoginModule
) {
    $QJLogger.log("MenuListController -> initialized");



    $scope.breadcrumb = {
        name: 'Menu Editor',
        list: [
            //{name:"None1",state:'module-project-list',fa:'fa-dashboard'},
            //{name:'None2',state:'',fa:'fa-dashboard'}
        ],
        active: "Menu Editor"
    };

    $scope.menuArr = []; //holds items from db
    $scope.menuData = null; //holds items divided per page

    //filter
    $QJCFilter.create({
        name: 'menuFilter',
        fields: [{
            name: 'description',
            arrayName: 'menuArr',
            bindTo: ['description']
        }, {
            name: '_profile_id',
            arrayName: 'menuArr',
            bindTo: ['_profile_id']
        }, {
            name: '_group_id',
            arrayName: 'menuArr',
            bindTo: ['_group_id']
        }]
    }, $scope);

    function loadControls() {
        //combobox
        $QJCCombobox.create({
            name: 'profileCBO',
            label: "Profile",
            code: -1,
            code_copyto: 'menuFilter.fields._profile_id',
            api: {
                controller: 'profile',
                params: {
                    action: 'combobox_all'
                }
            },
        }, $scope);
        //combobox
        $QJCCombobox.create({
            name: 'groupCBO',
            label: "Implementation group",
            code: -1,
            code_copyto: 'menuFilter.fields._group_id',
            api: {
                controller: 'group',
                params: {
                    action: 'combobox_all'
                }
            },
        }, $scope);
        //listview
        $QJCListview.create({
            name: 'menuLVW',
            dataArray: 'menuArr',
            pagedDataArray: 'menuData',
            api: {
                controller: 'menu',
                params: {
                    action: 'combobox_all'
                }
            },
            columns: [{
                    name: 'description',
                    label: 'Description'
                }
                //{name:'first_name',label:'First name'},
                //{name:'_profile_id',label:'Last name'}
            ],
            itemClick: function(item) {
                $QJHelperFunctions.changeState('module-menu-edit', {
                    id: item._id
                });
            }
        }, $scope);
    }


    //Load controls when current item its avaliable.
    var controlsLoaded = false;
    $rootScope.$on('currentUser.change', function() {
        loadControls();
        controlsLoaded = true;
    });
    if (!controlsLoaded && !_.isUndefined($rootScope.currentUser)) {
        loadControls();
        controlsLoaded = true;
    }
    //defaults
    $timeout(function() {
        $scope.menuFilter.filter();
    }, 2000);
})



module.controller('MenuEditController', function(
    $QJCCombobox, $QJLogger, $QJHelperFunctions, $scope, $rootScope, $QJLoginModule, $QJApi, $timeout, $state, $QJLoginModule
) {
    $QJLogger.log("MenuEditController -> initialized");

    var _menu_id = $state.params.id;

    $scope.crud = {
        errors: []
    }

    function showError(error) {
        $scope.crud.errors.push(error);
        return true;
    }

    function formHasErrors() {
        $scope.crud.errors = [];
        var hasErrors = false;
        if (_.isUndefined($scope.item.description) || $scope.item.description == '') {
            hasErrors = showError('Description required');
        }
        if (_.isUndefined($scope.item._group_id) || $scope.item._group_id == '') {
            hasErrors = showError('Group required');
        }
        if (_.isUndefined($scope.item._profile_id) || $scope.item._profile_id == '') {
            hasErrors = showError('Profile required');
        }
        return hasErrors;
    }

    $scope.save = function() {
        if (!formHasErrors()) {
            $QJApi.getController('menu').post({
                action: 'save'
            }, $scope.item, function(res) {
                $QJLogger.log("MenuEditController -> api post -> menu save -> success");
                //
                showError('Cambios guardados');
            });
        };
    };
    $scope.cancel = function() {
        $QJHelperFunctions.changeState('module-menu-list');
    };


    function loadControls() {
        //combobox
        $QJCCombobox.create({
            name: 'groupCBO',
            label: "Implementation group",
            code: $scope.item._group_id,
            code_copyto: 'item._group_id',
            api: {
                controller: 'group',
                params: {
                    action: 'combobox_all'
                }
            },
        }, $scope);
        //combobox
        $QJCCombobox.create({
            name: 'profileCBO',
            label: "Profile",
            code: $scope.item._profile_id,
            code_copyto: 'item._profile_id',
            api: {
                controller: 'profile',
                params: {
                    action: 'combobox_all'
                }
            },
        }, $scope);
    }



    //GET SINGLE USER
    $QJApi.getController('menu').get({
        action: 'single',
        id: _menu_id
    }, function(res) {
        $QJLogger.log("MenuEditController -> api get -> menu single -> success");
        $scope.item = res.items[0] || null;
        loadControls();
    });


});


;
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../controllers/mod.menuCtrl.js","/../controllers")
},{"+7ZJp0":4,"./_module_init.js":7,"buffer":1}],13:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var module = require('./_module_init.js');
module.controller('ProfileListController', function(
	$QJCCombobox, $QJCSelectkey, $QJCListview, $QJCFilter, $QJLogger, $QJHelperFunctions, $scope, $rootScope, $QJLoginModule, $QJApi, $timeout, $state, $QJLoginModule
) {

	$QJLogger.log("ProfileListController -> initialized");
	$scope.breadcrumb = {
		name: 'Profiles',
		list: [],
		active: "Profiles"
	};
	$scope.items = []; //holds items from db
	$scope.lvwData = null; //holds items divided per page

	//filter
	$QJCFilter.create({
		name: 'filter',
		fields: [{
			name: 'description',
			arrayName: 'items',
			bindTo: ['description']
		}]
	}, $scope);

	function loadControls() {
		//listview
		$QJCListview.create({
			name: 'lvw',
			dataArray: 'items',
			pagedDataArray: 'lvwData',
			api: {
				controller: 'profile',
				params: {
					action: 'combobox_all'
				}
			},
			columns: [{
				name: 'description',
				label: 'Description'
			}],
			itemClick: function(item) {
				$QJHelperFunctions.changeState('module-profile-edit', {
					id: item._id
				});
			}
		}, $scope);
	}


	//Load controls when current item its avaliable.
	var controlsLoaded = false;
	$rootScope.$on('currentUser.change', function() {
		loadControls();
		controlsLoaded = true;
	});
	if (!controlsLoaded && !_.isUndefined($rootScope.currentUser)) {
		loadControls();
		controlsLoaded = true;
	}
	//defaults
	$timeout(function() {
		$scope.filter.filter();
	}, 2000);
})

module.controller('ProfileEditController', function(
	$QJCCombobox, $QJCSelectkey, $QJCListview, $QJCFilter, $QJLogger, $QJHelperFunctions, $scope, $rootScope, $QJLoginModule, $QJApi, $timeout, $state, $QJLoginModule
) {

	$QJLogger.log("ProfileEditController -> initialized");
	$scope.breadcrumb = {
		name: 'Profile Edit',
		list: [{
			name: "Profiles",
			state: 'module-profile-list',
			//fa: 'fa-dashboard'
		}, ],
		active: "Loading..."
	};



	var _id = $state.params.id;

	$scope.crud = {
		errors: []
	}

	function showError(error) {
		$scope.crud.errors.push(error);
		return true;
	}

	function formHasErrors() {
		$scope.crud.errors = [];
		var hasErrors = false;
		if (_.isUndefined($scope.item.description) || $scope.item.description == '') {
			hasErrors = showError('Description required');
		}
		return hasErrors;
	}

	$scope.save = function() {
		if (!formHasErrors()) {
			$QJApi.getController('profile').post({
				action: 'save'
			}, $scope.item, function(res) {
				$QJLogger.log("ProfileEditController -> api post -> save -> success");
				//
				showError('Cambios guardados');
				$QJHelperFunctions.changeState('module-profile-list',{},500);
			});
		};
	};
	$scope.delete = function() {
		var r = confirm("Delete " + $scope.item.name + " ?");
		if (r == true) {
			$QJApi.getController('profile').post({
				action: 'delete'
			}, $scope.item, function(res) {
				$QJLogger.log("ProfileEditController -> delete -> success");
				//
				showError('Cambios guardados');
				showError($scope.item.description + ' eliminado');
				//
				$QJHelperFunctions.changeState('module-profile-list',{},500);

				create();
			});
		} else {}
	}
	$scope.cancel = function() {
		$QJHelperFunctions.changeState('module-profile-list');
	};

	function loadControls() {}

	function create() {
		$QJLogger.log("ProfileEditController -> create new!");
		$scope.item = {
			description: '',
			_id: -1
		};
	}
	if (_id == -1) {
		//CREATE
		create();
		loadControls();
	} else {
		//GET SINGLE USER
		$QJApi.getController('profile').get({
			action: 'single',
			id: _id
		}, function(res) {
			$QJLogger.log("ProfileEditController -> api get -> single -> success");
			$scope.item = res.item;
			$scope.breadcrumb.active = $scope.item.description;
			loadControls();
		});
	}

});

;
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../controllers/mod.profileCtrl.js","/../controllers")
},{"+7ZJp0":4,"./_module_init.js":7,"buffer":1}],14:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var module = require('./_module_init.js');
module.controller('ProjectHoursListController', function(
    $QJLocalSession, $QJCTimeCounter, $interval, $QJCCombobox, $QJCSelectkey, $QJCListview, $QJCFilter, $QJLogger, $QJHelperFunctions, $scope, $rootScope, $QJLoginModule, $QJApi, $timeout, $state, $QJLoginModule
) {
    $QJLogger.log("ProjectListController -> initialized");


    $scope.breadcrumb = {
        name: 'Projects Hours',
        list: [{
            name: 'Projects',
            state: 'module-project-list',
            //fa: 'fa-dashboard'
        }],
        active: "Projects Hours"
    };


    g.ProjectListController = $scope;

    $scope.items = []; //holds projects from db
    $scope.itemsData = null; //holds projects divided per page

    //filter
    $QJCFilter.create({
        name: 'projecthoursFilter',
        fields: [{
            name: 'loginname',
            arrayName: 'items',
            bindTo: ['loginname']
        }, {
            name: '_id_company',
            arrayName: 'items',
            bindTo: ['_id_company']
        }, {
            name: '_id_project',
            arrayName: 'items',
            bindTo: ['_id_project']
        }, {
            name: '_id_user',
            arrayName: 'items',
            bindTo: ['_id_user']
        }]
    }, $scope);


    function loadControls() {

        //--------
        //combobox
        $QJCCombobox.create({
            name: 'hourscompanyCBO',
            label: "Company",
            code: $rootScope.session.projecthours_hourscompanyCBOCODE || -1, //$rootScope.currentUser._group_id,
            code_copyto: 'hoursprojectCBO.api.params._id_company',
            //description_copyto: 'current.company',
            api: {
                controller: 'company',
                params: {
                    action: 'combobox_all'
                }
            },
        }, $scope);
        //combobox
        $QJCCombobox.create({
            name: 'hoursprojectCBO',
            label: "Project",
            code: $rootScope.session.projecthours_hoursprojectCBOCODE || -1, //$rootScope.currentUser._group_id,
            code_copyto: 'current.item._id_project',
            description_copyto: 'current.project',
            api: {
                controller: 'project',
                params: {
                    action: 'combobox_all',
                    _id_company: $scope.hourscompanyCBO.code || -1
                }
            },
        }, $scope)
        //--------


        //combobox
        $QJCCombobox.create({
            name: 'companyCBO',
            label: "Company",
            code: -1, //$rootScope.currentUser._group_id,
            code_copyto: 'projecthoursFilter.fields._id_company',
            api: {
                controller: 'company',
                params: {
                    action: 'combobox_all'
                }
            },
        }, $scope);
        //combobox
        $QJCCombobox.create({
            name: 'projectCBO',
            label: "Project",
            code: -1, //$rootScope.currentUser._group_id,
            code_copyto: 'projecthoursFilter.fields._id_project',
            api: {
                controller: 'project',
                params: {
                    action: 'combobox_all'
                }
            },
        }, $scope);
        //combobox
        $QJCCombobox.create({
            name: 'userCBO',
            label: "User",
            code: -1, //$rootScope.currentUser._group_id,
            code_copyto: 'projecthoursFilter.fields._id_user',
            api: {
                controller: 'user',
                params: {
                    action: 'combobox_all'
                }
            },
        }, $scope);



        //listview
        $QJCListview.create({
            name: 'projectshoursLVW',
            dataArray: 'items',
            pagedDataArray: 'itemsData',
            api: {
                controller: 'project',
                params: {
                    action: 'hours_all',
                    _id_project: -1
                }
            },
            columns: [{
                name: 'loginname',
                label: 'User'
            }, {
                name: 'differenceFormated',
                label: 'Tiempo (hms)'
            }, {
                name: 'startFormated',
                label: 'Start'
            }, {
                name: 'endFormated',
                label: 'End'
            }],
            itemClick: function(item) {
                $QJHelperFunctions.changeState('module-project-hours-edit', {
                    id: item._id
                });
            }
        }, $scope);

        $scope.$on("projectshoursLVW.update", function() {
            //console.info("projectshoursLVW.update");
            $scope.items = _.each($scope.items, function(item) {
                var diff = item.difference;
                var duration = {
                    hours: Math.round((diff / 1000 / 60 / 60) % 24),
                    minutes: Math.round((diff / 1000 / 60) % 60),
                    seconds: Math.round((diff / 1000) % 60)
                };
                var str = "";
                str += duration.hours + ":";
                str += duration.minutes + ":";
                str += duration.seconds + "";
                item.differenceFormated = str;
                item.startFormated = moment(parseInt(item.start)).format("DD-MM-YY h:mm:ss a");
                item.endFormated = moment(parseInt(item.end)).format("DD-MM-YY h:mm:ss a");
            });
            //$QJLogger.log("projectshoursLVW.update");
        });



    }



    $QJCTimeCounter.create({
        name: 'current',
        api: {
            controller: 'project',
            params: {
                action: 'hours_current',
                _id_project: -1
            }
        },
        onInit: function(self) {
            if (_.isUndefined(self.resitem) || _.isNull(self.resitem)) {
                self.item = {
                    _id: -1,
                    _id_project: $scope.hoursprojectCBO.code,
                    _id_user: null, //save current based on token.
                    start: null,
                    end: null,
                    difference: null
                };
            } else {
                self.item = self.resitem;
                self.resume(self.item.start);
            }
        },
        onStartChange: function(newVal, self) {
            self.item.start = newVal;
        },
        onStopChange: function(newVal, self) {
            self.item.end = newVal;
        },
        onDiffChange: function(newVal, newValFormated, self) {
            self.item.difference = newVal;
        },
        onValidateStart: function(self) {
            var val = !_.isUndefined(self.item) && !_.isUndefined(self.item._id_project) && self.item._id_project != null && self.item._id_project != "";
            if (!val) {
                self.errors = [];
                self.addError("Project required");
            }
            return val;
        },
        onStartClick: function(self) {
            $scope.hourscompanyCBO.disabled = true;
            $scope.hoursprojectCBO.disabled = true;
            //
            $QJApi.getController("project").post({
                action: 'hours_save'
            }, self.item, function(res) {
                $QJLogger.log("hours -> save -> success");
            });
        },
        onStopClick: function(self) {
            $scope.hourscompanyCBO.disabled = false;
            $scope.hoursprojectCBO.disabled = false;
            //
            $QJApi.getController("project").post({
                action: 'hours_save'
            }, self.item, function(res) {
                $QJLogger.log("hours -> save -> success");
                self.addError("Duration: " + $QJHelperFunctions.getTimestampDuration(self.item.difference));
                self.addError("Timestamp saved");
                $scope.projectshoursLVW.update();
                $scope.$emit('project.update', {
                    initializeTimer: false
                });
            });
            //

            if ($scope.projectinfo) {
                $scope.projectinfo.show = false;
            }
        }
    }, $scope); //.init();
    $scope.$on('hoursprojectCBO.change', function() {
        $scope.$emit('project.update', {
            initializeTimer: true
        });
    });

    $scope.$on('project.update', function(arg, params) {

        //stores company,project
        $rootScope.session.projecthours_hourscompanyCBOCODE = $scope.hourscompanyCBO.code;
        $rootScope.session.projecthours_hoursprojectCBOCODE = $scope.hoursprojectCBO.code;
        $QJLocalSession.save();


        var _id_project = $scope.hoursprojectCBO.code; //UPDATE INFORMATION ABOUT PROJECT HOURS
        if (_id_project != -1) {
            updateProjectInfo(_id_project);

            if (params.initializeTimer) {
                $scope.current.api.params._id_project = _id_project; //ifa prj its selected. Update timer status
                $scope.current.init();
            }
        }

    });

    function updateProjectInfo(_id_project) {
        $QJApi.getController("project").get({
            action: "hours_all",
            _id_project: _id_project.toString()
        }, function(res) {
            $QJLogger.log("project hours_all -> success");
            var hours = [];
            _.each(res.items, function(item) {
                var exists = !_.isUndefined(_.find(hours, function(infoItem) {
                    return infoItem.loginname == item.loginname;
                }));

                if (item.end == null) exists = true; //
                if (exists) return;
                var hoursfrom = _.filter(res.items, function(i) {
                    return i.loginname == item.loginname;
                });
                var diff = 0;
                _.each(hoursfrom, function(i) {
                    diff += parseInt(i.difference);
                });

                hours.push({
                    loginname: item.loginname,
                    diff: diff,
                    diffFormated: $QJHelperFunctions.getTimestampDuration(diff)
                });
            });
            //console.info(info);
            var hoursTotal = 0;
            _.each(hours, function(i) {
                hoursTotal += parseInt(i.diff);
            });
            $scope.projectinfo = {
                hours: hours,
                hoursTotal: hoursTotal,
                hoursTotalFormated: $QJHelperFunctions.getTimestampDuration(hoursTotal),
                show: true
            };
            //console.info($scope.projectinfo);
        });
    }

    //Load controls when current user its avaliable.
    var controlsLoaded = false;
    $rootScope.$on('currentUser.change', function() {
        loadControls();
        controlsLoaded = true;
    });
    if (!controlsLoaded && !_.isUndefined($rootScope.currentUser)) {
        loadControls();
        controlsLoaded = true;
    }

    //defaults
    $timeout(function() {
        $scope.projecthoursFilter.filter();
    }, 2000);


    scope = $scope;

})



module.controller('ProjectHoursEditController', function(
    $QJCCombobox, $QJCSelectkey, $QJCListview, $QJCFilter, $QJLogger, $QJHelperFunctions, $scope, $rootScope, $QJLoginModule, $QJApi, $timeout, $state, $QJLoginModule
) {


    $QJLogger.log("ProjectHoursEditController -> initialized");


    $scope.breadcrumb = {
        name: 'Project Hours',
        list: [{
            name: 'Projects Hours',
            state: 'module-project-hours-list',
            //fa: 'fa-dashboard'
        }],
        active: "Loading"
    };


    var _id = $state.params.id;

    $scope.crud = {
        errors: []
    }

    function showError(error) {
        $scope.crud.errors.push(error);
        return true;
    }

    function formHasErrors() {
        $scope.crud.errors = [];
        var hasErrors = false;
        if (_.isUndefined($scope.item.start) || $scope.item.start == '') {
            hasErrors = showError('Start required');
        }
        if (_.isUndefined($scope.item.end) || $scope.item.end == '') {
            hasErrors = showError('End required');
        }
        return hasErrors;
    }

    $scope.save = function() {
        if (!formHasErrors()) {
            $QJApi.getController('project').post({
                action: 'hours_save'
            }, $scope.item, function(res) {
                $QJLogger.log("ProjectHoursEditController -> -> project hours_save -> success");
                //
                showError('Cambios guardados');
            });
        };
    };
    $scope.cancel = function() {
        $QJHelperFunctions.changeState('module-project-hours-list');
    };
    $scope.delete = function() {
        var r = confirm("Delete [" + $scope.item.start + " - " + $scope.item.end + "] ?");
        if (r == true) {
            $QJApi.getController('project').post({
                action: 'hours_delete'
            }, $scope.item, function(res) {
                $QJLogger.log("ProjectHoursEditController -> project delete -> success");
                //
                showError('Cambios guardados');
                showError($scope.item.name + ' eliminado');

                $timeout(function() {
                    $QJHelperFunctions.changeState('module-project-hours-list');
                }, 500);

            });
        } else {}
    }


    function create() {
        $QJLogger.log("ProjectHoursEditController -> create new!");
        $scope.item = {
            _id: -1,
            _id_project: '',
            _id_user: '',
            start: '',
            end: '',
            milliseconds: '',
        };
    }

    function loadControls() {


    }

    if (_id == -1) {
        //CREATE
        //create();
        loadControls();
    } else {
        //UPDATE
        $QJApi.getController('project').get({
            action: 'hours_single',
            id: _id
        }, function(res) {
            $QJLogger.log("ProjectHoursEditController -> project hours_single -> success");
            //console.info(res.item);
            $scope.item = res.item;
            $scope.breadcrumb.active = $scope.item.userName + "'s Timestamp";
            loadControls();
        });

    }
});
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../controllers/mod.projecthoursCtrl.js","/../controllers")
},{"+7ZJp0":4,"./_module_init.js":7,"buffer":1}],15:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var module = require('./_module_init.js');
module.controller('ProjectListController', function(
    $QJCCombobox, $QJCSelectkey, $QJCListview, $QJCFilter, $QJLogger, $QJHelperFunctions, $scope, $rootScope, $QJLoginModule, $QJApi, $timeout, $state, $QJLoginModule
) {

    $QJLogger.log("ProjectListController -> initialized");


    $scope.breadcrumb = {
        name: 'Projects',
        list: [
            //{name:'None2',state:'',fa:'fa-dashboard'}
        ],
        active: "Projects"
    };

    $scope.projects = []; //holds projects from db
    $scope.projectsData = null; //holds projects divided per page

    //filter
    $QJCFilter.create({
        name: 'projectsFilter',
        fields: [{
            name: 'name',
            arrayName: 'projects',
            bindTo: ['name']
        }, {
            name: 'description',
            arrayName: 'projects',
            bindTo: ['description']
        }, {
            name: '_id_company',
            arrayName: 'projects',
            bindTo: ['_id_company']
        }]
    }, $scope);


    function loadControls() {
        //combobox
        $QJCCombobox.create({
            name: 'companyCBO',
            label: "Company",
            code: -1, //$rootScope.currentUser._group_id,
            code_copyto: 'projectsFilter.fields._id_company',
            api: {
                controller: 'company',
                params: {
                    action: 'combobox_all'
                }
            },
        }, $scope);
        //listview
        $QJCListview.create({
            name: 'projectsLVW',
            dataArray: 'projects',
            pagedDataArray: 'projectsData',
            api: {
                controller: 'project',
                params: {
                    action: 'all',
                    _id_company: -1
                }
            },
            columns: [{
                name: 'name',
                label: 'Name'
            }, {
                name: 'description',
                label: 'Description'
            }, {
                name: 'companyDescription',
                label: 'Company'
            }],
            itemClick: function(item) {
                $QJHelperFunctions.changeState('module-project-edit', {
                    id: item._id
                });
            }
        }, $scope);
    }


    //Load controls when current user its avaliable.
    var controlsLoaded = false;
    $rootScope.$on('currentUser.change', function() {
        loadControls();
        controlsLoaded = true;
    });
    if (!controlsLoaded && !_.isUndefined($rootScope.currentUser)) {
        loadControls();
        controlsLoaded = true;
    }

    //defaults
    $timeout(function() {
        $scope.projectsFilter.filter();
    }, 2000);

})

module.controller('ProjectEditController', function(
    $QJCCombobox, $QJCSelectkey, $QJCListview, $QJCFilter, $QJLogger, $QJHelperFunctions, $scope, $rootScope, $QJLoginModule, $QJApi, $timeout, $state, $QJLoginModule
) {

    $QJLogger.log("ProjectEditController -> initialized");

    $scope.breadcrumb = {
        name: 'Project',
        list: [{
            name: 'Projects',
            state: 'module-project-list',
            //fa: 'fa-dashboard'
        }],
        active: 'Loading...'
    };


    var _project_id = $state.params.id;

    $scope.crud = {
        errors: []
    }

    function showError(error) {
        $scope.crud.errors.push(error);
        return true;
    }

    function formHasErrors() {
        $scope.crud.errors = [];
        var hasErrors = false;
        if (_.isUndefined($scope.item.name) || $scope.item.name == '') {
            hasErrors = showError('Name required');
        }
        /*
        if (_.isUndefined($scope.item.description) || $scope.item.description == '') {
            hasErrors = showError('First name required');
        }
        */
        if (_.isUndefined($scope.item._id_company) || $scope.item._id_company == '') {
            hasErrors = showError('Company required');
        }
        return hasErrors;
    }

    $scope.save = function() {
        if (!formHasErrors()) {
            $QJApi.getController('project').post({
                action: 'save'
            }, $scope.item, function(res) {
                $QJLogger.log("ProjectEditController -> -> project save -> success");
                //
                showError('Cambios guardados');
            });
        };
    };
    $scope.cancel = function() {
        $QJHelperFunctions.changeState('module-project-list');
    };
    $scope.delete = function() {
        var r = confirm("Delete " + $scope.item.name + " ?");
        if (r == true) {
            $QJApi.getController('project').post({
                action: 'delete'
            }, $scope.item, function(res) {
                $QJLogger.log("ProjectEditController -> project delete -> success");
                //
                showError('Cambios guardados');
                showError($scope.item.name + ' eliminado');

                $timeout(function() {
                    $QJHelperFunctions.changeState('module-project-list');
                }, 500);

                create();
            });
        } else {}
    }


    function create() {
        $QJLogger.log("ProjectEditController -> create new!");
        $scope.item = {
            name: '',
            description: '',
            _id_company: '',
            _id: -1
        };
    }

    function loadControls() {
        //combobox
        $QJCCombobox.create({
            name: 'companyCBO',
            label: "Company",
            code: $scope.item._id_company,
            code_copyto: 'item._id_company',
            api: {
                controller: 'company',
                params: {
                    action: 'combobox_all'
                }
            },
        }, $scope);
    }

    if (_project_id == -1) {
        //CREATE
        create();
        loadControls();
    } else {
        //UPDATE
        $QJApi.getController('project').get({
            action: 'single',
            id: _project_id
        }, function(res) {
            $QJLogger.log("ProjectEditController -> project single -> success");
            console.info(res.item);
            $scope.item = res.item;

            $scope.breadcrumb.active = $scope.item.name;

            loadControls();
        });

    }

});


;
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../controllers/mod.projectsCtrl.js","/../controllers")
},{"+7ZJp0":4,"./_module_init.js":7,"buffer":1}],16:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var module = require('./_module_init.js');
module.controller('UsergroupListController', function(
	$QJCCombobox, $QJCSelectkey, $QJCListview, $QJCFilter, $QJLogger, $QJHelperFunctions, $scope, $rootScope, $QJLoginModule, $QJApi, $timeout, $state, $QJLoginModule
) {

	$QJLogger.log("UsergroupListController -> initialized");
	$scope.breadcrumb = {
		name: 'Usergroups',
		list: [],
		active: "Usergroups"
	};
	$scope.items = []; //holds items from db
	$scope.lvwData = null; //holds items divided per page

	//filter
	$QJCFilter.create({
		name: 'filter',
		fields: [{
			name: 'description',
			arrayName: 'items',
			bindTo: ['description']
		}, {
			name: '_id_profile',
			arrayName: 'items',
			bindTo: ['_id_profile']
		}]
	}, $scope);

	function loadControls() {
		//combobox
		$QJCCombobox.create({
			name: 'profileCBO',
			label: "Profile",
			code: -1,
			code_copyto: 'filter.fields._id_profile',
			api: {
				controller: 'profile',
				params: {
					action: 'combobox_all'
				}
			},
		}, $scope);
		//listview
		$QJCListview.create({
			name: 'lvw',
			dataArray: 'items',
			pagedDataArray: 'lvwData',
			api: {
				controller: 'usergroup',
				params: {
					action: 'lvwdata'
				}
			},
			columns: [{
				name: 'description',
				label: 'Description'
			}, {
				name: 'profileDescription',
				label: 'Profile'
			}],
			itemClick: function(item) {
				$QJHelperFunctions.changeState('module-usergroup-edit', {
					id: item._id
				});
			}
		}, $scope);
	}


	//Load controls when current item its avaliable.
	var controlsLoaded = false;
	$rootScope.$on('currentUser.change', function() {
		loadControls();
		controlsLoaded = true;
	});
	if (!controlsLoaded && !_.isUndefined($rootScope.currentUser)) {
		loadControls();
		controlsLoaded = true;
	}
	//defaults
	$timeout(function() {
		$scope.filter.filter();
	}, 2000);
})

module.controller('UsergroupEditController', function(
	$QJCCombobox, $QJCSelectkey, $QJCListview, $QJCFilter, $QJLogger, $QJHelperFunctions, $scope, $rootScope, $QJLoginModule, $QJApi, $timeout, $state, $QJLoginModule
) {

	$QJLogger.log("UsergroupEditController -> initialized");
	$scope.breadcrumb = {
		name: 'Usergroup Edit',
		list: [{
			name: "Usergroups",
			state: 'module-usergroup-list',
			//fa: 'fa-dashboard'
		}, ],
		active: "Loading..."
	};



	var _id = $state.params.id;

	$scope.crud = {
		errors: []
	}

	function showError(error) {
		$scope.crud.errors.push(error);
		return true;
	}

	function formHasErrors() {
		$scope.crud.errors = [];
		var hasErrors = false;
		if (_.isUndefined($scope.item.description) || $scope.item.description == '') {
			hasErrors = showError('Description required');
		}
		if (_.isUndefined($scope.item._id_profile) || $scope.item._id_profile == '') {
			hasErrors = showError('Profile required');
		}
		return hasErrors;
	}

	$scope.save = function() {
		if (!formHasErrors()) {
			$QJApi.getController('usergroup').post({
				action: 'save'
			}, $scope.item, function(res) {
				$QJLogger.log("UsergroupEditController -> api post -> save -> success");
				//
				showError('Cambios guardados');
				$QJHelperFunctions.changeState('module-usergroup-list', {}, 500);
			});
		};
	};
	$scope.delete = function() {
		var r = confirm("Delete " + $scope.item.name + " ?");
		if (r == true) {
			$QJApi.getController('usergroup').post({
				action: 'delete'
			}, $scope.item, function(res) {
				$QJLogger.log("UsergroupEditController -> delete -> success");
				//
				showError('Cambios guardados');
				showError($scope.item.description + ' eliminado');
				//
				$QJHelperFunctions.changeState('module-usergroup-list', {}, 500);

				create();
			});
		} else {}
	}
	$scope.cancel = function() {
		$QJHelperFunctions.changeState('module-usergroup-list');
	};

	function loadControls() {

		//combobox
		$QJCCombobox.create({
			name: 'profileCBO',
			label: "Profile",
			code: $scope.item._id_profile,
			code_copyto: 'item._id_profile',
			api: {
				controller: 'profile',
				params: {
					action: 'combobox_all'
				}
			},
		}, $scope);

	}

	function create() {
		$QJLogger.log("UsergroupEditController -> create new!");
		$scope.item = {
			description: '',
			_id_profile: '',
			_id: -1
		};
	}
	if (_id == -1) {
		//CREATE
		create();
		loadControls();
	} else {
		//GET SINGLE USER
		$QJApi.getController('usergroup').get({
			action: 'single',
			id: _id
		}, function(res) {
			$QJLogger.log("UsergroupEditController -> api get -> single -> success");
			$scope.item = res.item;
			$scope.breadcrumb.active = $scope.item.description;
			loadControls();
		});
	}

});

;
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../controllers/mod.usergroupCtrl.js","/../controllers")
},{"+7ZJp0":4,"./_module_init.js":7,"buffer":1}],17:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var module = require('./_module_init.js');
module.controller('UserListController', function(
    $QJCCombobox, $QJCSelectkey, $QJCListview, $QJCFilter, $QJLogger, $QJHelperFunctions, $scope, $rootScope, $QJLoginModule, $QJApi, $timeout, $state, $QJLoginModule
) {



    $QJLogger.log("UserListController -> initialized");



    $scope.breadcrumb = {
        name: 'Users',
        list: [
            //{name:"None1",state:'module-project-list',fa:'fa-dashboard'},
            //{name:'None2',state:'',fa:'fa-dashboard'}
        ],
        active: "Users"
    };


    //console.info($rootScope.config);

    $scope.users = []; //holds users from db
    $scope.usersData = null; //holds users divided per page

    //filter
    $QJCFilter.create({
        name: 'usersFilter',
        fields: [{
            name: 'loginname',
            arrayName: 'users',
            bindTo: ['loginname']
        }, {
            name: 'text',
            arrayName: 'users',
            bindTo: ['first_name', 'last_name']
        }, {
            name: '_usergroup_id',
            arrayName: 'users',
            bindTo: ['_usergroup_id']
        }]
    }, $scope);

    /*
    //selectkey
    $QJCSelectkey.create({
        name: 'usersUsergroupSLK',
        label: "Usergroup",
        code: 7,
        text: "No disponible",
        code_copyto: 'usersFilter.fields._usergroup_id',
        search: function() {
            console.info('grupo de usuario lick')
        }
    }, $scope);
*/

    function loadControls() {


        //combobox
        $QJCCombobox.create({
            name: 'usersUsergroupCBO',
            label: "Usergroup",
            code: -1, //$rootScope.currentUser._group_id,
            code_copyto: 'usersFilter.fields._usergroup_id',
            api: {
                controller: 'usergroup',
                params: {
                    action: 'combobox'
                }
            },
        }, $scope);
        //listview
        $QJCListview.create({
            name: 'usersLVW',
            dataArray: 'users',
            pagedDataArray: 'usersData',
            api: {
                controller: 'user',
                params: {
                    action: 'all'
                }
            },
            columns: [{
                name: 'loginname',
                label: 'Username'
            }, {
                name: 'first_name',
                label: 'First name'
            }, {
                name: 'last_name',
                label: 'Last name'
            }],
            itemClick: function(item) {
                $QJHelperFunctions.changeState('module-user-edit', {
                    id: item._id
                });
            }
        }, $scope);
    }


    //Load controls when current user its avaliable.
    var controlsLoaded = false;
    $rootScope.$on('currentUser.change', function() {
        loadControls();
        controlsLoaded = true;
    });
    if (!controlsLoaded && !_.isUndefined($rootScope.currentUser)) {
        loadControls();
        controlsLoaded = true;
    }


    //defaults
    $timeout(function() {
        $scope.usersFilter.filter();
    }, 2000);
})



module.controller('UserEditController', function(
    $QJCCombobox, $QJLogger, $QJHelperFunctions, $scope, $rootScope, $QJLoginModule, $QJApi, $timeout, $state, $QJLoginModule
) {
    $QJLogger.log("UserEditController -> initialized");


    $scope.breadcrumb = {
        name: 'User',
        list: [{
            name: "Users",
            state: 'module-user-list',
            //fa: 'fa-dashboard'
        }, ],
        active: 'Loading...'
    };


    var _user_id = $state.params.id;

    $scope.crud = {
        errors: []
    }

    function showError(error) {
        $scope.crud.errors.push(error);
        return true;
    }

    function formHasErrors() {
        $scope.crud.errors = [];
        var hasErrors = false;
        if (_.isUndefined($scope.item.loginname) || $scope.item.loginname == '') {
            hasErrors = showError('Username required');
        }
        if (_.isUndefined($scope.item.first_name) || $scope.item.first_name == '') {
            hasErrors = showError('First name required');
        }
        if (_.isUndefined($scope.item.last_name) || $scope.item.last_name == '') {
            hasErrors = showError('Last name required');
        }
        if (_.isUndefined($scope.item._usergroup_id) || $scope.item._usergroup_id == '') {
            hasErrors = showError('Usergroup required');
        }
        return hasErrors;
    }

    $scope.save = function() {
        if (!formHasErrors()) {
            //console.info('Salvando!');
            $QJApi.getController('user').post({
                action: 'save'
            }, $scope.item, function(res) {
                $QJLogger.log("UserEditController -> user -> api post -> user save -> success");
                //
                showError('Cambios guardados');
            });
        };
    };
    $scope.cancel = function() {
        $QJHelperFunctions.changeState('module-user-list');
    };
    $scope.delete = function() {
        var r = confirm("Delete " + $scope.item.loginname + " ?");
        if (r == true) {
            $QJApi.getController('user').post({
                action: 'delete'
            }, $scope.item, function(res) {
                $QJLogger.log("UserEditController -> user -> api post -> user delete -> success");
                //
                showError('Cambios guardados');
                showError($scope.item.loginname + ' eliminado');
                create();
            });
        } else {}
    }


    function create() {
        $scope.item = {
            loginname: '',
            first_name: '',
            last_name: '',
            password: '',
            _usergroup_id: $scope.item._usergroup_id || '',
            _id: -1
        };
    }

    function loadControls() {

        //combobox only items who user has access
        $QJCCombobox.create({
            name: 'userEditUsergroupAccessCBO',
            label: "Usergroup",
            code: $scope.item._usergroup_id,
            disabled:true,
            code_copyto: 'item._usergroup_id',
            api: {
                controller: 'usergroup',
                params: {
                    action: 'combobox_access'
                }
            },
        }, $scope);


        //combobox
        $QJCCombobox.create({
            name: 'userEditUsergroupCBO',
            label: "Usergroup",
            code: $scope.item._usergroup_id,
            code_copyto: 'item._usergroup_id',
            api: {
                controller: 'usergroup',
                params: {
                    action: 'combobox'
                }
            },
        }, $scope);
    }

    if (_user_id == -1) {
        //CREATE
        create();
        loadControls();
    } else {
        //UPDATE
        $QJApi.getController('user').get({
            action: 'single',
            id: _user_id
        }, function(res) {
            $QJLogger.log("UserEditController -> user -> api get -> user single -> success");
            $scope.item = res.user;
            $scope.breadcrumb.active = $scope.item.loginname;
            loadControls();
        });

    }



});


;
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../controllers/mod.usersCtrl.js","/../controllers")
},{"+7ZJp0":4,"./_module_init.js":7,"buffer":1}],18:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var module = require('./_module_init.js');
module.controller('NavController', function(
	$QJLogger, $QJHelperFunctions, $QJApi,
	$scope, $rootScope, $QJLoginModule, $QJLocalSession, $QJConfig) {
	$QJLogger.log("NavController -> initialized");

	//Siempre que entra al home recupera los datos del usuario actual y los setea globalmente en el rootScope.
	$QJApi.getController('user').get({
		action: 'current'
	}, function(res) {
		$QJLogger.log("HomeController -> user -> api get -> user single -> success");
		$rootScope.currentUser = res.user;
		$rootScope.session.user = res.user;
		$rootScope.$emit('currentUser.change');
		//console.info(res);



	});

	$scope.signout = function() {
		$rootScope.session.token = null;
		store.clear();
		$QJHelperFunctions.changeState('login');
		$QJLogger.log("NavController -> signout -> at " + new Date());
	}
});
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../controllers/navCtrl.js","/../controllers")
},{"+7ZJp0":4,"./_module_init.js":7,"buffer":1}],19:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var module = require('./_module_init.js');
module.controller('QJBackendSettingsController', function(
	$QJAuth, $QJCCombobox, $QJLogger, $QJHelperFunctions, $scope, $rootScope, $QJLoginModule, $QJApi, $timeout, $state, $QJLoginModule
) {
	$QJLogger.log("QJBackendSettingsController -> initialized");


	$scope.breadcrumb = {
		name: 'Settings',
		list: [
			//{name:'None2',state:'',fa:'fa-dashboard'}
		],
		active: "Settings"
	};

	function loadControls() {
		//combobox
		$QJCCombobox.create({
			name: 'configGroupCBO',
			label: "Grupo de implementacion",
			code: $scope.stats._group_id,
			//code_copyto: 'usersFilter.fields._usergroup_id',
			api: {
				controller: 'group',
				params: {
					action: 'combobox_assoc'
				}
			},
		}, $scope);
	}

	function onTokenUpdate(callback) {
		$QJApi.getController('user').get({
			action: 'current'
		}, function(res) {
			$QJLogger.log("HomeController -> user -> current  -> success");
			$scope.stats = res.user;
			//console.info(res);
			callback();
		});
	}
	$rootScope.$on('session.change', function() {
		onTokenUpdate(function() {});
	});
	onTokenUpdate(function() {
		loadControls();
	});


	$scope.$on('configGroupCBO.change', function(args1, args2) {
		if (args2.selectedValue !== -1 && args2.selectedValue !== $scope.stats._group_id) {
			console.info('changing impl');
			$QJApi.getController('auth').post({
				action: 'changegroup'
			}, {
				_group_id: args2.selectedValue
			}, function(res) {
				$QJLogger.log("HomeController -> auth -> changegroup  -> success");
				$QJAuth.updateSessionCustom(res.token, args2.selectedValue);
			});

		}
	});

});
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../controllers/settingsCtrl.js","/../controllers")
},{"+7ZJp0":4,"./_module_init.js":7,"buffer":1}],20:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var module = require('./_module_init.js');
module.controller('SidebarController', function(
    $QJLogger, $scope, $rootScope, $QJLoginModule, $QJLocalSession, $QJConfig, $QJApi) {
    $QJLogger.log("SidebarController -> initialized");

    function getNodesForCurrentToken() {
        //Siempre que carga el sidebar recupera el menu para el usuario
        $QJApi.getController('module').get({
            action: 'menu'
        }, function(res) {
            $QJLogger.log("SidebarController -> api get -> module menu -> success");
            //console.info(res);
            $scope.modules = res.modules;
        });
    }

    $rootScope.$on('session.change', function(args1, args2) {
        getNodesForCurrentToken();
    });

    getNodesForCurrentToken();
});
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../controllers/sidebarCtrl.js","/../controllers")
},{"+7ZJp0":4,"./_module_init.js":7,"buffer":1}],21:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var module = require('./_module_init.js');
module.controller('VipsterConfigController', function(
    $QJCCombobox, $QJCSelectkey, $QJCListview, $QJCFilter, $QJLogger
    , $QJHelperFunctions, $scope, $rootScope, $QJLoginModule, $QJApi, $timeout, $state, $QJLoginModule
) {
    $QJLogger.log("VipsterConfigController -> initialized");


});

}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../controllers/vp.configCtrl.js","/../controllers")
},{"+7ZJp0":4,"./_module_init.js":7,"buffer":1}],22:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
module.exports = angular.module('app.controls', []);
require('./qjcomboboxCtrl.js');
require('./qjfilterCtrl.js');
require('./qjlistviewCtrl.js');
require('./qjtimercounterCtrl.js');
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../controls/_module_init.js","/../controls")
},{"+7ZJp0":4,"./qjcomboboxCtrl.js":23,"./qjfilterCtrl.js":24,"./qjlistviewCtrl.js":25,"./qjtimercounterCtrl.js":26,"buffer":1}],23:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var module = require('./_module_init.js');
module.factory('$QJCCombobox', [
	'$QJApi', '$QJHelperFunctions', '$QJLogger', '$rootScope', '$state', '$timeout', '$QJLocalSession', '$QJAuth',
	function($QJApi, $QJHelperFunctions, $QJLogger, $rootScope, $state, $timeout, $QJLocalSession, $QJAuth) {
		function seekObject(fullname, $scope, obj, index) {
			if (index == 0) {
				$QJLogger.log('QJCSelectkey -> seekObject -> something went wrong and i abort the recursive func bro!');
			}
			if (!_.isUndefined(obj) && _.isNull(obj)) {
				return obj;
			}
			if (fullname.toString().split('.').length == 1 || index == 0) {
				if (!_.isUndefined(obj)) {
					return obj[fullname] || null;
				} else {
					return $scope[fullname] || null;
				}

			} else {
				var firstPart = fullname.toString().split('.')[0];
				var rest = fullname.substring(firstPart.length + 1);
				//console.log("obj ->"+obj);
				//console.log("firstpart->"+firstPart);
				//console.log("rest->"+rest);
				return seekObject(rest, $scope, obj != null ? obj[firstPart] : $scope[firstPart], (_.isUndefined(index) ? 20 : index--));
			}
		};
		return {
			create: function(settings, $scope) {

				/*
				console.info('QJCCombobox ->  LOAD '
					+ ' CODE['+settings.code+']'
				);
*/

				settings.code_copyto = settings.code_copyto || null;
				settings.description_copyto = settings.description_copyto || null;


				var self = settings;

				self.initialValue = settings.code;
				self.selectedValue = self.selectedValue || -1;
				self.disabled = self.disabled || false;

				self.ngSelected = function(item) {
					return item._id == self.initialValue;
				};

				$scope[settings.name] = self; //sets to the scope !!!!

				if (typeof cbo == "undefined") {
					cbo = [];
				}
				cbo.push(self);

				$scope.$watch(settings.name + ".selectedValue", function(newVal, oldVal) {
					self.code = newVal;
					$scope.$emit(settings.name + '.change', {
						selectedValue: newVal
					});
				});
				$scope.$watch(settings.name + ".code", function(newVal, oldVal) {
					self.selectedValue = newVal;

					self.description = (_.find(self.items, function(item) {
						return item._id == newVal;
					}));
					self.description = self.description && self.description.description || "";

					$scope.$emit(settings.name + '.change', {
						selectedValue: newVal
					});
				});

				function copy(obj, fieldWord, val) {
					if (_.isUndefined(val)) {
						return;
					}
					if (val.toString() === '-1') {
						obj[fieldWord] = '';
					} else {
						obj[fieldWord] = val;
					}
				}

				function copyWhenPosible(fullpath, val) {
					if (_.isUndefined(fullpath) || _.isNull(fullpath) || fullpath.length == 0) {
						return; //omit!
					}
					var cuts = fullpath.toString().split('.');
					var fieldWord = cuts[cuts.length - 1];
					var pos = fullpath.toString().indexOf('.' + fieldWord);
					var path = fullpath.toString().substring(0, pos);
					//console.info("seeking for path obj on _>>>> "+path);
					var obj = seekObject(path, $scope);
					//console.info("founded "+JSON.stringify(obj));
					if (_.isUndefined(obj) || _.isNull(obj)) {
						console.info("copyWhenPosible failure for path -> " + fullpath);
						return; //omit!
					}
					copy(obj, fieldWord, val);
				}


				$scope.$watch(settings.name + '.code', function(newVal, oldVal) {
					copyWhenPosible(self.code_copyto, newVal);
				});
				copyWhenPosible(self.code_copyto, self.code || '');



				//set defaults
				$scope.$emit(settings.name + '.change', {
					selectedValue: self.code
				});

				if (self.description_copyto != null) {
					var cuts = self.description_copyto.toString().split('.');
					self.description_copyto_fieldWord = cuts[cuts.length - 1];
					var pos = self.description_copyto.toString().indexOf('.' + self.description_copyto_fieldWord);
					var path = self.description_copyto.toString().substring(0, pos);
					self.description_copyto_obj = seekObject(path, $scope);
					$scope.$watch(settings.name + '.description', function(newVal, oldVal) {
						copy(self.description_copyto_obj, self.description_copyto_fieldWord, newVal);
					});
					copy(self.description_copyto_obj, self.description_copyto_fieldWord, self.description || '');
					$scope.$emit(settings.name + '.description', {
						description: self.description
					});
				}


				self.update = function() {
					$QJApi.getController(settings.api.controller).get(settings.api.params, function(res) {
						//$QJLogger.log("QJCCombobox -> "+settings.name+" -> " + settings.api.controller + "  " + settings.api.params.action + " ("+JSON.stringify(settings.api.params)+") -> success");
						self.items = res.items;
						self.selectedValue = self.initialValue;
						//console.info(res.req);
					});
				};
				self.update(); //initial

				//watch for params change to update
				$scope.$watch(settings.name + '.api.params', function(newVal, oldVal) {
					self.update();
					//$QJLogger.log("QJCCombobox -> " + settings.name + " -> params changes -> updating..");
				}, true);


			}
		};
	}
]);
module.directive('qjccombobox', function($rootScope) {
	var directive = {};
	directive.restrict = 'E'; /* restrict this directive to elements */
	directive.templateUrl = "pages/controls/qjccombobox.html";
	directive.scope = {
		cbo: '='
	};
	directive.compile = function(element, attributes) {
		var linkFunction = function($scope, element, attributes) {}
		return linkFunction;
	}
	return directive;
});
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../controls/qjcomboboxCtrl.js","/../controls")
},{"+7ZJp0":4,"./_module_init.js":22,"buffer":1}],24:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var module = require('./_module_init.js');
module.factory('$QJCFilter', [
	'$QJLogger', '$rootScope', '$state', '$timeout', '$QJLocalSession', '$QJAuth',
	function($QJLogger, $rootScope, $state, $timeout, $QJLocalSession, $QJAuth) {
		var self = {
			fields: {}
		};

		function getBindedArray(arrayName, $scope, obj, index) {
			if (index == 0) {
				$QJLogger.log('QJCFilter -> getBindedArray -> something went wrong and i abort the recursive func bro!');
			}
			if (!_.isUndefined(obj) && _.isNull(obj)) {
				return obj;
			}
			if (arrayName.toString().split('.').length == 1 || index == 0) {
				//console.info(arrayName);
				if (!_.isUndefined(obj)) {
					return obj[arrayName] || null;
				} else {
					//console.info('return this ->'+arrayName);
					//console.info($scope[arrayName]);
					return $scope[arrayName] || null;
				}

			} else {
				var firstPart = arrayName.toString().split('.')[0];
				var rest = arrayName.substring(firstPart.length + 1);
				//console.info(arrayName);
				return getBindedArray(rest, $scope, $scope[firstPart], (_.isUndefined(index) ? 20 : index--));
			}

		};
		return {
			create: function(settings, $scope) {
				_.each(settings.fields, function(field, key) {
					self.fields[field.name] = null;
				});

				//defaults
				settings.filteredfieldName = settings.filteredfieldName || '_qjfiltered';

				//stores settings as property
				self.settings = settings;
				$scope[settings.name] = self;

				self.filter = function() {
					//console.clear();
					containValidationSuccessItemsKeys = [];
					_.each(self.fields, function(val, key) {
						var keyWhoChanges = key; //updates based on all filters ! fix
						var newFieldValue = val;
						_.each(settings.fields, function(field, key) {
							if (keyWhoChanges !== field.name) return; //take only the one who changes
							var bindedArray = getBindedArray(field.arrayName, $scope);
							if (bindedArray !== null) {
								_.each(bindedArray, function(bindedArrayItem, bindedArrayItemKey) {
									bindedArrayItemHasSuccessAny = (null != _.find(containValidationSuccessItemsKeys, function(val) {
										return val == bindedArrayItemKey
									}));
									if (bindedArrayItemHasSuccessAny) {
										return; // jump because alredy succes validation and it not gonna be filtered
									}
									var containValidationResponse = [];
									_.each(field.bindTo, function(bindToField, key) {
										var _field = bindedArrayItem[bindToField];
										if (!_.isUndefined(_field)) {
											if (_field !== null) {
												var flag = true;
												if (_.isUndefined(newFieldValue) || _.isNull(newFieldValue) || newFieldValue == "") {
													return; // jump because filter field is empty!
												} else {
													var indexof = _field.toString().toLowerCase().indexOf(newFieldValue.toString().toLowerCase());
													if (indexof !== -1) {
														flag = true;
													} else {
														flag = false;
													}
												}
												containValidationResponse.push(flag);

											} else {
												$QJLogger.log("QJCFilter -> Warning -> bindedArrayItem " + bindToField + " at index " + bindedArrayItemKey + " is null so its omited from filtering");
											}
										} else {
											$QJLogger.log("QJCFilter -> Warning -> bindedArrayItem " + bindToField + " do not exists in " + field.arrayName);
										}
									});
									var passContainValidation = (null != _.find(containValidationResponse, function(val) {
										return val == true
									}));
									bindedArrayItem[settings.filteredfieldName] = !passContainValidation;
									if (containValidationResponse.length == 0) {
										bindedArrayItem[settings.filteredfieldName] = false; //no hubo respuestas por lo tanto no se filtra
									}
									if (bindedArrayItem[settings.filteredfieldName]) {
										containValidationSuccessItemsKeys.push(bindedArrayItemKey); //si se filtra una ves jump para el resto
									}
								});
							} else {
								$QJLogger.log("QJCFilter -> Warning -> arrayName " + field.arrayName + " for filter field " + field.name + " do not exists on the scope");
							}
						});
					});
					$scope.$emit('qjcfilter.update', {
						filteredfieldName: settings.filteredfieldName
					});
				};
				$scope.$watch(settings.name + '.fields', function(newValue, oldValue) {
					self.filter();
				}, true);
			}
		}
	}
]);
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../controls/qjfilterCtrl.js","/../controls")
},{"+7ZJp0":4,"./_module_init.js":22,"buffer":1}],25:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var module = require('./_module_init.js');
module.factory('$QJCListview', [
	'$QJApi', '$QJHelperFunctions', '$QJLogger', '$rootScope', '$state', '$timeout', '$QJLocalSession', '$QJAuth',
	function($QJApi, $QJHelperFunctions, $QJLogger, $rootScope, $state, $timeout, $QJLocalSession, $QJAuth) {


		function createPagedList(items, entriesPerPage) {
			var pagesCounter = 1;
			var pages = [];
			//
			var _currItemIndex = 0;
			var _currPage = [];
			while (_currItemIndex < items.length) { //ej: 0 < 5
				if (_currPage.length < entriesPerPage) {
					_currPage.push(items[_currItemIndex]);
					_currItemIndex++;
				} else {
					pages.push(_currPage);
					_currPage = [];
					pagesCounter++;
				}
			}
			if (_currPage.length > 0) {
				pages.push(_currPage);
			}
			return pages;
		}

		function buildListViewData(items) {
			var entriesPerPage = $rootScope.config.listviewEntriesPerPage; //ej: 2   
			var pages = [];
			if (!_.isUndefined(items)) {
				pages = createPagedList(items, entriesPerPage);
			}
			var pageNumbers = [];
			_.each(pages, function(e, index) {
				pageNumbers.push(index + 1);
			});
			var _lvData = {
				currentPageIndex: 0,
				currentPage: pages[0],
				totalPages: pages.length,
				totalItems: items.length,
				pages: pages,
				pagination: {
					pageNumbers: pageNumbers,
					disabledForPrevLink: function() {
						return _lvData.currentPageIndex === 0 ? true : false;
					},
					disabledForNextLink: function() {
						return _lvData.currentPageIndex >= pages.length - 1 ? true : false;
					},
					activeForLink: function(pageNumber) {
						if ((pageNumber === _lvData.currentPageIndex + 1)) {
							return true;
						} else {
							return false;
						}
					},
					goto: function(pageNumber) {
						_lvData.currentPageIndex = pageNumber - 1;
						_lvData.currentPage = pages[_lvData.currentPageIndex];
					},
					next: function() {
						_lvData.currentPageIndex++;
						if (_lvData.currentPageIndex >= pages.length) {
							_lvData.currentPageIndex = pages.length - 1;
						}
						_lvData.currentPage = pages[_lvData.currentPageIndex];
					},
					prev: function() {
						_lvData.currentPageIndex--;
						if (_lvData.currentPageIndex <= 0) {
							_lvData.currentPageIndex = 0;
						}
						_lvData.currentPage = pages[_lvData.currentPageIndex];
					}
				}
			};
			return _lvData;
		}
		return {
			create: function(settings, $scope) {
				//instance private
				function render(items) {
					$scope[settings.pagedDataArray] = buildListViewData(items);
				}



				//watch
				$scope.$watch(settings.dataArray, function(newValue, oldValue) {

					if (_.isUndefined($scope[settings.dataArray])) {
						$QJLogger.log("WARNING: QJCListview -> " + settings.dataArray + " -> " + " dataArray undefined");
						return;
					}

					$scope[settings.pagedDataArray] = buildListViewData($scope[settings.dataArray]);
					render($scope[settings.dataArray]);
				});


				$scope.$on('qjcfilter.update', function(args1, args2) {
					$scope.$emit(settings.name + ".update", {});
					var filteredData = _.filter($scope[settings.dataArray], function(item) {
						return !item[args2.filteredfieldName];
					});
					render(filteredData);

					var filteredCount = _.filter($scope[settings.dataArray], function(item) {
						return item[args2.filteredfieldName] == true;
					});
					$scope.$emit('qjclistview.filter.success', {
						filteredCount: filteredCount
					});

				});

				var self = settings;
				$scope[settings.name] = self;

				self.update = function() {
					//DB
					$QJApi.getController(settings.api.controller).get(settings.api.params, function(res) {
						$QJLogger.log("QJCListview -> " + settings.api.controller + " " + settings.api.params.action + " -> success");
						$scope[settings.dataArray] = res.items;
						$scope.$emit(settings.name + ".update", {});
						//console.info($scope[settings.dataArray]);
					});
					//$scope.$emit(settings.name+".update",{});
				};
				self.update();


			}
		};
	}
]);


module.directive('qjclistview', function() {
	var directive = {};
	directive.restrict = 'E'; /* restrict this directive to elements */
	directive.templateUrl = "pages/controls/qjclistview.html";
	directive.scope = {
		data: "=",
		lvw: "="
	}
	directive.compile = function(element, attributes) {
		var linkFunction = function($scope, element, attributes) {}
		return linkFunction;
	}
	return directive;
});
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../controls/qjlistviewCtrl.js","/../controls")
},{"+7ZJp0":4,"./_module_init.js":22,"buffer":1}],26:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var module = require('./_module_init.js');
module.factory('$QJCTimeCounter', [
	'$interval', '$QJApi', '$QJHelperFunctions', '$QJLogger', '$rootScope', '$state', '$timeout', '$QJLocalSession', '$QJAuth',
	function($interval, $QJApi, $QJHelperFunctions, $QJLogger, $rootScope, $state, $timeout, $QJLocalSession, $QJAuth) {
		return {
			create: function(settings, $scope) {
				var self = _.extend(settings, {
					working: false,
					project: "none",
					startTimeFormated: null,
					endTimeFormated: null,
					errors: [],
					callingApi: false
				});
				self.addError = function(error) {
					self.errors.push(error);
					$timeout(function() {
						$scope.$apply(function() {
							self.errors = [];
						});
					}, 2000);
				};
				self.restart = function() {
					self.startTimeFormated = null;
					self.endTimeFormated = null;
					self.errors = [];
					self.diffFormated = null;
				};
				self.init = function() {
					if (self.callingApi) return; //calling apy sync please.
					self.restart();
					self.callingApi = true;
					$QJApi.getController(settings.api.controller).get(settings.api.params, function(res) {
						self.callingApi = false;
						$QJLogger.log("QJCTimeCounter -> " + JSON.stringify(settings.api) + " -> success");
						self.working = (res.item != null);
						self.resitem = res.item;
						if (!_.isUndefined(settings.onInit)) {
							settings.onInit(self);
						}
					});
					return self;
				};
				self.getTime = function() {
					return new Date().getTime();
				};
				self.getTimeFormated = function() {
					return moment(self.getTime()).format("dddd, MMMM Do YYYY, h:mm:ss a");
				};
				self.getDiff = function(milli) {
					var actual = self.getTime();
					return (actual - milli);
				};
				self.getDiffFormated = function(milli) {
					var diff = self.getDiff(milli);
					var duration = {
						hours: Math.round((diff / 1000 / 60 / 60) % 24),
						minutes: Math.round((diff / 1000 / 60) % 60),
						seconds: Math.round((diff / 1000) % 60)
					};
					var str = "";
					str += duration.hours + " hours, ";
					str += duration.minutes + " mins, ";
					str += duration.seconds + " secs, ";
					//str += diff + " total, ";
					return str;
				};
				self.validateStart = function() {
					if (!_.isUndefined(settings.onValidateStart)) {
						return settings.onValidateStart(self);
					} else {
						return true;
					}
				};
				self.resume = function(from) {
					self.start(from);
				};
				self.start = function(start) {
					if (!self.validateStart()) {
						return;
					} else {
						//console.info("TIMER STARTED FAIL");
					}

					//
					//console.info("TIMER STARTED");

					if (start && start.length > 0) {
						self._startVal = parseInt(start);
					} else {
						self._startVal = self.getTime(); //start setted	
					}

					if (!_.isUndefined(settings.onStartChange)) {
						settings.onStartChange(self._startVal, self);
					}
					self.startTimeFormated = self.getTimeFormated(); //start formated setted
					self.endTimeFormated = self.startTimeFormated; //end setted
					self.diff = self.getDiff(self._startVal);
					self.diffFormated = self.getDiffFormated(self._startVal);
					if (!_.isUndefined(settings.onDiffChange)) {
						settings.onDiffChange(self.diff, self.diffFormated, self);
					}
					self.workingInterval = $interval(function() {
						if (!self.working) return;
						self._stopVal = self.getTime();
						if (!_.isUndefined(settings.onStopChange)) {
							settings.onStopChange(self._stopVal, self);
						}
						self.endTimeFormated = self.getTimeFormated();
						self.diff = self.getDiff(self._startVal);
						self.diffFormated = self.getDiffFormated(self._startVal);
						if (!_.isUndefined(settings.onDiffChange)) {
							settings.onDiffChange(self.diff, self.diffFormated, self);
						}
					}, 1000);
					self.working = true;
					if (!_.isUndefined(settings.onStartClick)) {
						settings.onStartClick(self);
					}
				};
				self.stop = function() {
					self.working = false;
					$interval.cancel(self.workingInterval);
					if (!_.isUndefined(settings.onStopClick)) {
						settings.onStopClick(self);
					}
				};
				$scope[settings.name] = self;
				return self;
			}
		};
	}
]);
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../controls/qjtimercounterCtrl.js","/../controls")
},{"+7ZJp0":4,"./_module_init.js":22,"buffer":1}],27:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
module.exports = angular.module('app.directives', []);
require('./ngenterDirective.js');
require('./qjapiinfoDirective.js');
require('./qjbreadcrumbDirective.js');
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../directives/_module_init.js","/../directives")
},{"+7ZJp0":4,"./ngenterDirective.js":28,"./qjapiinfoDirective.js":29,"./qjbreadcrumbDirective.js":30,"buffer":1}],28:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var module = require('./_module_init.js');
module.directive('ngEnter', function() {
	return function(scope, element, attrs) {
		element.bind("keydown keypress", function(event) {
			if (event.which === 13) {
				scope.$apply(function() {
					scope.$eval(attrs.ngEnter);
				});

				event.preventDefault();
			}
		});
	};
});
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../directives/ngenterDirective.js","/../directives")
},{"+7ZJp0":4,"./_module_init.js":27,"buffer":1}],29:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var module = require('./_module_init.js');
//
module.directive('qjapiinfo', function() {
	var directive = {};
	directive.restrict = 'E'; /* restrict this directive to elements */
	directive.templateUrl = "pages/controls/qjapiinfo.html";
	directive.compile = function(element, attributes) {
		var linkFunction = function($scope, element, attributes) {}
		return linkFunction;
	}
	return directive;
});
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../directives/qjapiinfoDirective.js","/../directives")
},{"+7ZJp0":4,"./_module_init.js":27,"buffer":1}],30:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var module = require('./_module_init.js');
//
module.directive('qjbreadcrumb', function($QJHelperFunctions) {
	var directive = {};
	directive.restrict = 'E'; /* restrict this directive to elements */
	directive.templateUrl = "pages/module_directives/module.breadcrumb.directive.html";
	directive.scope = {
		data: "="
	}
	directive.compile = function(element, attributes) {
		var linkFunction = function($scope, element, attributes) {

			$scope.data.goto = function(item) {
				$QJHelperFunctions.changeState(item.state, item.params);
			};

		}
		return linkFunction;
	}
	return directive;
});
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../directives/qjbreadcrumbDirective.js","/../directives")
},{"+7ZJp0":4,"./_module_init.js":27,"buffer":1}],31:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
/*!
 * Author: Abdullah A Almsaeed
 * Date: 4 Jan 2014
 * Description:
 *      This file should be included in all pages
 !**/

/*
 * Global variables. If you change any of these vars, don't forget 
 * to change the values in the less files!
 */
var left_side_width = 220; //Sidebar width in pixels

$(function() {
    "use strict";

    //Enable sidebar toggle
    $("[data-toggle='offcanvas']").click(function(e) {
        e.preventDefault();

        //If window is small enough, enable sidebar push menu
        if ($(window).width() <= 992) {
            $('.row-offcanvas').toggleClass('active');
            $('.left-side').removeClass("collapse-left");
            $(".right-side").removeClass("strech");
            $('.row-offcanvas').toggleClass("relative");
        } else {
            //Else, enable content streching
            $('.left-side').toggleClass("collapse-left");
            $(".right-side").toggleClass("strech");
        }
    });

    //Add hover support for touch devices
    $('.btn').bind('touchstart', function() {
        $(this).addClass('hover');
    }).bind('touchend', function() {
        $(this).removeClass('hover');
    });

    //Activate tooltips
    $("[data-toggle='tooltip']").tooltip();

    /*     
     * Add collapse and remove events to boxes
     */
    $("[data-widget='collapse']").click(function() {
        //Find the box parent        
        var box = $(this).parents(".box").first();
        //Find the body and the footer
        var bf = box.find(".box-body, .box-footer");
        if (!box.hasClass("collapsed-box")) {
            box.addClass("collapsed-box");
            bf.slideUp();
        } else {
            box.removeClass("collapsed-box");
            bf.slideDown();
        }
    });

    /*
     * ADD SLIMSCROLL TO THE TOP NAV DROPDOWNS
     * ---------------------------------------
     */
    $(".navbar .menu").slimscroll({
        height: "200px",
        alwaysVisible: false,
        size: "3px"
    }).css("width", "100%");

    /*
     * INITIALIZE BUTTON TOGGLE
     * ------------------------
     */
    $('.btn-group[data-toggle="btn-toggle"]').each(function() {
        var group = $(this);
        $(this).find(".btn").click(function(e) {
            group.find(".btn.active").removeClass("active");
            $(this).addClass("active");
            e.preventDefault();
        });

    });

    $("[data-widget='remove']").click(function() {
        //Find the box parent        
        var box = $(this).parents(".box").first();
        box.slideUp();
    });

    /* Sidebar tree view */
    $(".sidebar .treeview").tree();

    /* 
     * Make sure that the sidebar is streched full height
     * ---------------------------------------------
     * We are gonna assign a min-height value every time the
     * wrapper gets resized and upon page load. We will use
     * Ben Alman's method for detecting the resize event.
     * 
     **/
    function _fix() {
        //Get window height and the wrapper height
        var height = $(window).height() - $("body > .header").height();
        $(".wrapper").css("min-height", height + "px");
        var content = $(".right-side").height();
        //If the wrapper height is greater than the window
        if (content > height)
            //then set sidebar height to the wrapper
            $(".left-side, html, body").css("min-height", content + "px");
        else {
            //Otherwise, set the sidebar to the height of the window
            $(".left-side, html, body").css("min-height", height + "px");
        }
    }
    //Fire upon load
    _fix();
    //Fire when wrapper is resized
    $(".wrapper").resize(function() {
        _fix();
        fix_sidebar();
    });

    //Fix the fixed layout sidebar scroll bug
    fix_sidebar();

    /*
     * We are gonna initialize all checkbox and radio inputs to 
     * iCheck plugin in.
     * You can find the documentation at http://fronteed.com/iCheck/
     */
    $("input[type='checkbox'], input[type='radio']").iCheck({
        checkboxClass: 'icheckbox_minimal',
        radioClass: 'iradio_minimal'
    });

});
function fix_sidebar() {
    //Make sure the body tag has the .fixed class
    if (!$("body").hasClass("fixed")) {
        return;
    }

    //Add slimscroll
    $(".sidebar").slimscroll({
        height: ($(window).height() - $(".header").height()) + "px",
        color: "rgba(0,0,0,0.2)"
    });
}
function change_layout() {
    $("body").toggleClass("fixed");
    fix_sidebar();
}
function change_skin(cls) {
    $("body").removeClass("skin-blue skin-black");
    $("body").addClass(cls);
}
/*END DEMO*/
$(window).load(function() {
    /*! pace 0.4.17 */
    (function() {
        var a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p, q, r, s, t, u, v, w, x, y, z, A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T, U, V = [].slice, W = {}.hasOwnProperty, X = function(a, b) {
            function c() {
                this.constructor = a
            }
            for (var d in b)
                W.call(b, d) && (a[d] = b[d]);
            return c.prototype = b.prototype, a.prototype = new c, a.__super__ = b.prototype, a
        }, Y = [].indexOf || function(a) {
            for (var b = 0, c = this.length; c > b; b++)
                if (b in this && this[b] === a)
                    return b;
            return-1
        };
        for (t = {catchupTime:500, initialRate:.03, minTime:500, ghostTime:500, maxProgressPerFrame:10, easeFactor:1.25, startOnPageLoad:!0, restartOnPushState:!0, restartOnRequestAfter:500, target:"body", elements:{checkInterval:100, selectors:["body"]}, eventLag:{minSamples:10, sampleCount:3, lagThreshold:3}, ajax:{trackMethods:["GET"], trackWebSockets:!1}}, B = function() {
            var a;
            return null != (a = "undefined" != typeof performance && null !== performance ? "function" == typeof performance.now ? performance.now() : void 0 : void 0) ? a : +new Date
        }, D = window.requestAnimationFrame || window.mozRequestAnimationFrame || window.webkitRequestAnimationFrame || window.msRequestAnimationFrame, s = window.cancelAnimationFrame || window.mozCancelAnimationFrame, null == D && (D = function(a) {
            return setTimeout(a, 50)
        }, s = function(a) {
            return clearTimeout(a)
        }), F = function(a) {
            var b, c;
            return b = B(), (c = function() {
                var d;
                return d = B() - b, d >= 33 ? (b = B(), a(d, function() {
                    return D(c)
                })) : setTimeout(c, 33 - d)
            })()
        }, E = function() {
            var a, b, c;
            return c = arguments[0], b = arguments[1], a = 3 <= arguments.length ? V.call(arguments, 2) : [], "function" == typeof c[b] ? c[b].apply(c, a) : c[b]
        }, u = function() {
            var a, b, c, d, e, f, g;
            for (b = arguments[0], d = 2 <= arguments.length?V.call(arguments, 1):[], f = 0, g = d.length; g > f; f++)
                if (c = d[f])
                    for (a in c)
                        W.call(c, a) && (e = c[a], null != b[a] && "object" == typeof b[a] && null != e && "object" == typeof e ? u(b[a], e) : b[a] = e);
            return b
        }, p = function(a) {
            var b, c, d, e, f;
            for (c = b = 0, e = 0, f = a.length; f > e; e++)
                d = a[e], c += Math.abs(d), b++;
            return c / b
        }, w = function(a, b) {
            var c, d, e;
            if (null == a && (a = "options"), null == b && (b = !0), e = document.querySelector("[data-pace-" + a + "]")) {
                if (c = e.getAttribute("data-pace-" + a), !b)
                    return c;
                try {
                    return JSON.parse(c)
                } catch (f) {
                    return d = f, "undefined" != typeof console && null !== console ? console.error("Error parsing inline pace options", d) : void 0
                }
            }
        }, g = function() {
            function a() {
            }
            return a.prototype.on = function(a, b, c, d) {
                var e;
                return null == d && (d = !1), null == this.bindings && (this.bindings = {}), null == (e = this.bindings)[a] && (e[a] = []), this.bindings[a].push({handler: b, ctx: c, once: d})
            }, a.prototype.once = function(a, b, c) {
                return this.on(a, b, c, !0)
            }, a.prototype.off = function(a, b) {
                var c, d, e;
                if (null != (null != (d = this.bindings) ? d[a] : void 0)) {
                    if (null == b)
                        return delete this.bindings[a];
                    for (c = 0, e = []; c < this.bindings[a].length; )
                        this.bindings[a][c].handler === b ? e.push(this.bindings[a].splice(c, 1)) : e.push(c++);
                    return e
                }
            }, a.prototype.trigger = function() {
                var a, b, c, d, e, f, g, h, i;
                if (c = arguments[0], a = 2 <= arguments.length ? V.call(arguments, 1) : [], null != (g = this.bindings) ? g[c] : void 0) {
                    for (e = 0, i = []; e < this.bindings[c].length; )
                        h = this.bindings[c][e], d = h.handler, b = h.ctx, f = h.once, d.apply(null != b ? b : this, a), f ? i.push(this.bindings[c].splice(e, 1)) : i.push(e++);
                    return i
                }
            }, a
        }(), null == window.Pace && (window.Pace = {}), u(Pace, g.prototype), C = Pace.options = u({}, t, window.paceOptions, w()), S = ["ajax", "document", "eventLag", "elements"], O = 0, Q = S.length; Q > O; O++)
            I = S[O], C[I] === !0 && (C[I] = t[I]);
        i = function(a) {
            function b() {
                return T = b.__super__.constructor.apply(this, arguments)
            }
            return X(b, a), b
        }(Error), b = function() {
            function a() {
                this.progress = 0
            }
            return a.prototype.getElement = function() {
                var a;
                if (null == this.el) {
                    if (a = document.querySelector(C.target), !a)
                        throw new i;
                    this.el = document.createElement("div"), this.el.className = "pace pace-active", document.body.className = document.body.className.replace("pace-done", ""), document.body.className += " pace-running", this.el.innerHTML = '<div class="pace-progress">\n  <div class="pace-progress-inner"></div>\n</div>\n<div class="pace-activity"></div>', null != a.firstChild ? a.insertBefore(this.el, a.firstChild) : a.appendChild(this.el)
                }
                return this.el
            }, a.prototype.finish = function() {
                var a;
                return a = this.getElement(), a.className = a.className.replace("pace-active", ""), a.className += " pace-inactive", document.body.className = document.body.className.replace("pace-running", ""), document.body.className += " pace-done"
            }, a.prototype.update = function(a) {
                return this.progress = a, this.render()
            }, a.prototype.destroy = function() {
                try {
                    this.getElement().parentNode.removeChild(this.getElement())
                } catch (a) {
                    i = a
                }
                return this.el = void 0
            }, a.prototype.render = function() {
                var a, b;
                return null == document.querySelector(C.target) ? !1 : (a = this.getElement(), a.children[0].style.width = "" + this.progress + "%", (!this.lastRenderedProgress || this.lastRenderedProgress | 0 !== this.progress | 0) && (a.children[0].setAttribute("data-progress-text", "" + (0 | this.progress) + "%"), this.progress >= 100 ? b = "99" : (b = this.progress < 10 ? "0" : "", b += 0 | this.progress), a.children[0].setAttribute("data-progress", "" + b)), this.lastRenderedProgress = this.progress)
            }, a.prototype.done = function() {
                return this.progress >= 100
            }, a
        }(), h = function() {
            function a() {
                this.bindings = {}
            }
            return a.prototype.trigger = function(a, b) {
                var c, d, e, f, g;
                if (null != this.bindings[a]) {
                    for (f = this.bindings[a], g = [], d = 0, e = f.length; e > d; d++)
                        c = f[d], g.push(c.call(this, b));
                    return g
                }
            }, a.prototype.on = function(a, b) {
                var c;
                return null == (c = this.bindings)[a] && (c[a] = []), this.bindings[a].push(b)
            }, a
        }(), N = window.XMLHttpRequest, M = window.XDomainRequest, L = window.WebSocket, v = function(a, b) {
            var c, d, e, f;
            f = [];
            for (d in b.prototype)
                try {
                    e = b.prototype[d], null == a[d] && "function" != typeof e ? f.push(a[d] = e) : f.push(void 0)
                } catch (g) {
                    c = g
                }
            return f
        }, z = [], Pace.ignore = function() {
            var a, b, c;
            return b = arguments[0], a = 2 <= arguments.length ? V.call(arguments, 1) : [], z.unshift("ignore"), c = b.apply(null, a), z.shift(), c
        }, Pace.track = function() {
            var a, b, c;
            return b = arguments[0], a = 2 <= arguments.length ? V.call(arguments, 1) : [], z.unshift("track"), c = b.apply(null, a), z.shift(), c
        }, H = function(a) {
            var b;
            if (null == a && (a = "GET"), "track" === z[0])
                return"force";
            if (!z.length && C.ajax) {
                if ("socket" === a && C.ajax.trackWebSockets)
                    return!0;
                if (b = a.toUpperCase(), Y.call(C.ajax.trackMethods, b) >= 0)
                    return!0
            }
            return!1
        }, j = function(a) {
            function b() {
                var a, c = this;
                b.__super__.constructor.apply(this, arguments), a = function(a) {
                    var b;
                    return b = a.open, a.open = function(d, e) {
                        return H(d) && c.trigger("request", {type: d, url: e, request: a}), b.apply(a, arguments)
                    }
                }, window.XMLHttpRequest = function(b) {
                    var c;
                    return c = new N(b), a(c), c
                }, v(window.XMLHttpRequest, N), null != M && (window.XDomainRequest = function() {
                    var b;
                    return b = new M, a(b), b
                }, v(window.XDomainRequest, M)), null != L && C.ajax.trackWebSockets && (window.WebSocket = function(a, b) {
                    var d;
                    return d = new L(a, b), H("socket") && c.trigger("request", {type: "socket", url: a, protocols: b, request: d}), d
                }, v(window.WebSocket, L))
            }
            return X(b, a), b
        }(h), P = null, x = function() {
            return null == P && (P = new j), P
        }, x().on("request", function(b) {
            var c, d, e, f;
            return f = b.type, e = b.request, Pace.running || C.restartOnRequestAfter === !1 && "force" !== H(f) ? void 0 : (d = arguments, c = C.restartOnRequestAfter || 0, "boolean" == typeof c && (c = 0), setTimeout(function() {
                var b, c, g, h, i, j;
                if (b = "socket" === f ? e.readyState < 2 : 0 < (h = e.readyState) && 4 > h) {
                    for (Pace.restart(), i = Pace.sources, j = [], c = 0, g = i.length; g > c; c++) {
                        if (I = i[c], I instanceof a) {
                            I.watch.apply(I, d);
                            break
                        }
                        j.push(void 0)
                    }
                    return j
                }
            }, c))
        }), a = function() {
            function a() {
                var a = this;
                this.elements = [], x().on("request", function() {
                    return a.watch.apply(a, arguments)
                })
            }
            return a.prototype.watch = function(a) {
                var b, c, d;
                return d = a.type, b = a.request, c = "socket" === d ? new m(b) : new n(b), this.elements.push(c)
            }, a
        }(), n = function() {
            function a(a) {
                var b, c, d, e, f, g, h = this;
                if (this.progress = 0, null != window.ProgressEvent)
                    for (c = null, a.addEventListener("progress", function(a) {
                        return h.progress = a.lengthComputable ? 100 * a.loaded / a.total : h.progress + (100 - h.progress) / 2
                    }), g = ["load", "abort", "timeout", "error"], d = 0, e = g.length; e > d; d++)
                        b = g[d], a.addEventListener(b, function() {
                            return h.progress = 100
                        });
                else
                    f = a.onreadystatechange, a.onreadystatechange = function() {
                        var b;
                        return 0 === (b = a.readyState) || 4 === b ? h.progress = 100 : 3 === a.readyState && (h.progress = 50), "function" == typeof f ? f.apply(null, arguments) : void 0
                    }
            }
            return a
        }(), m = function() {
            function a(a) {
                var b, c, d, e, f = this;
                for (this.progress = 0, e = ["error", "open"], c = 0, d = e.length; d > c; c++)
                    b = e[c], a.addEventListener(b, function() {
                        return f.progress = 100
                    })
            }
            return a
        }(), d = function() {
            function a(a) {
                var b, c, d, f;
                for (null == a && (a = {}), this.elements = [], null == a.selectors && (a.selectors = []), f = a.selectors, c = 0, d = f.length; d > c; c++)
                    b = f[c], this.elements.push(new e(b))
            }
            return a
        }(), e = function() {
            function a(a) {
                this.selector = a, this.progress = 0, this.check()
            }
            return a.prototype.check = function() {
                var a = this;
                return document.querySelector(this.selector) ? this.done() : setTimeout(function() {
                    return a.check()
                }, C.elements.checkInterval)
            }, a.prototype.done = function() {
                return this.progress = 100
            }, a
        }(), c = function() {
            function a() {
                var a, b, c = this;
                this.progress = null != (b = this.states[document.readyState]) ? b : 100, a = document.onreadystatechange, document.onreadystatechange = function() {
                    return null != c.states[document.readyState] && (c.progress = c.states[document.readyState]), "function" == typeof a ? a.apply(null, arguments) : void 0
                }
            }
            return a.prototype.states = {loading: 0, interactive: 50, complete: 100}, a
        }(), f = function() {
            function a() {
                var a, b, c, d, e, f = this;
                this.progress = 0, a = 0, e = [], d = 0, c = B(), b = setInterval(function() {
                    var g;
                    return g = B() - c - 50, c = B(), e.push(g), e.length > C.eventLag.sampleCount && e.shift(), a = p(e), ++d >= C.eventLag.minSamples && a < C.eventLag.lagThreshold ? (f.progress = 100, clearInterval(b)) : f.progress = 100 * (3 / (a + 3))
                }, 50)
            }
            return a
        }(), l = function() {
            function a(a) {
                this.source = a, this.last = this.sinceLastUpdate = 0, this.rate = C.initialRate, this.catchup = 0, this.progress = this.lastProgress = 0, null != this.source && (this.progress = E(this.source, "progress"))
            }
            return a.prototype.tick = function(a, b) {
                var c;
                return null == b && (b = E(this.source, "progress")), b >= 100 && (this.done = !0), b === this.last ? this.sinceLastUpdate += a : (this.sinceLastUpdate && (this.rate = (b - this.last) / this.sinceLastUpdate), this.catchup = (b - this.progress) / C.catchupTime, this.sinceLastUpdate = 0, this.last = b), b > this.progress && (this.progress += this.catchup * a), c = 1 - Math.pow(this.progress / 100, C.easeFactor), this.progress += c * this.rate * a, this.progress = Math.min(this.lastProgress + C.maxProgressPerFrame, this.progress), this.progress = Math.max(0, this.progress), this.progress = Math.min(100, this.progress), this.lastProgress = this.progress, this.progress
            }, a
        }(), J = null, G = null, q = null, K = null, o = null, r = null, Pace.running = !1, y = function() {
            return C.restartOnPushState ? Pace.restart() : void 0
        }, null != window.history.pushState && (R = window.history.pushState, window.history.pushState = function() {
            return y(), R.apply(window.history, arguments)
        }), null != window.history.replaceState && (U = window.history.replaceState, window.history.replaceState = function() {
            return y(), U.apply(window.history, arguments)
        }), k = {ajax: a, elements: d, document: c, eventLag: f}, (A = function() {
            var a, c, d, e, f, g, h, i;
            for (Pace.sources = J = [], g = ["ajax", "elements", "document", "eventLag"], c = 0, e = g.length; e > c; c++)
                a = g[c], C[a] !== !1 && J.push(new k[a](C[a]));
            for (i = null != (h = C.extraSources)?h:[], d = 0, f = i.length; f > d; d++)
                I = i[d], J.push(new I(C));
            return Pace.bar = q = new b, G = [], K = new l
        })(), Pace.stop = function() {
            return Pace.trigger("stop"), Pace.running = !1, q.destroy(), r = !0, null != o && ("function" == typeof s && s(o), o = null), A()
        }, Pace.restart = function() {
            return Pace.trigger("restart"), Pace.stop(), Pace.start()
        }, Pace.go = function() {
            return Pace.running = !0, q.render(), r = !1, o = F(function(a, b) {
                var c, d, e, f, g, h, i, j, k, m, n, o, p, s, t, u, v;
                for (j = 100 - q.progress, d = o = 0, e = !0, h = p = 0, t = J.length; t > p; h = ++p)
                    for (I = J[h], m = null != G[h]?G[h]:G[h] = [], g = null != (v = I.elements)?v:[I], i = s = 0, u = g.length; u > s; i = ++s)
                        f = g[i], k = null != m[i] ? m[i] : m[i] = new l(f), e &= k.done, k.done || (d++, o += k.tick(a));
                return c = o / d, q.update(K.tick(a, c)), n = B(), q.done() || e || r ? (q.update(100), Pace.trigger("done"), setTimeout(function() {
                    return q.finish(), Pace.running = !1, Pace.trigger("hide")
                }, Math.max(C.ghostTime, Math.min(C.minTime, B() - n)))) : b()
            })
        }, Pace.start = function(a) {
            u(C, a), Pace.running = !0;
            try {
                q.render()
            } catch (b) {
                i = b
            }
            return document.querySelector(".pace") ? (Pace.trigger("start"), Pace.go()) : setTimeout(Pace.start, 50)
        }, "function" == typeof define && define.amd ? define('theme-app', [], function() {
            return Pace
        }) : "object" == typeof exports ? module.exports = Pace : C.startOnPageLoad && Pace.start()
    }).call(this);
});

/* 
 * BOX REFRESH BUTTON 
 * ------------------
 * This is a custom plugin to use with the compenet BOX. It allows you to add
 * a refresh button to the box. It converts the box's state to a loading state.
 * 
 * USAGE:
 *  $("#box-widget").boxRefresh( options );
 * */
(function($) {
    "use strict";

    $.fn.boxRefresh = function(options) {

        // Render options
        var settings = $.extend({
            //Refressh button selector
            trigger: ".refresh-btn",
            //File source to be loaded (e.g: ajax/src.php)
            source: "",
            //Callbacks
            onLoadStart: function(box) {
            }, //Right after the button has been clicked
            onLoadDone: function(box) {
            } //When the source has been loaded

        }, options);

        //The overlay
        var overlay = $('<div class="overlay"></div><div class="loading-img"></div>');

        return this.each(function() {
            //if a source is specified
            if (settings.source === "") {
                if (console) {
                    console.log("Please specify a source first - boxRefresh()");
                }
                return;
            }
            //the box
            var box = $(this);
            //the button
            var rBtn = box.find(settings.trigger).first();

            //On trigger click
            rBtn.click(function(e) {
                e.preventDefault();
                //Add loading overlay
                start(box);

                //Perform ajax call
                box.find(".box-body").load(settings.source, function() {
                    done(box);
                });


            });

        });

        function start(box) {
            //Add overlay and loading img
            box.append(overlay);

            settings.onLoadStart.call(box);
        }

        function done(box) {
            //Remove overlay and loading img
            box.find(overlay).remove();

            settings.onLoadDone.call(box);
        }

    };

})(jQuery);

/*
 * SIDEBAR MENU
 * ------------
 * This is a custom plugin for the sidebar menu. It provides a tree view.
 * 
 * Usage:
 * $(".sidebar).tree();
 * 
 * Note: This plugin does not accept any options. Instead, it only requires a class
 *       added to the element that contains a sub-menu.
 *       
 * When used with the sidebar, for example, it would look something like this:
 * <ul class='sidebar-menu'>
 *      <li class="treeview active">
 *          <a href="#>Menu</a>
 *          <ul class='treeview-menu'>
 *              <li class='active'><a href=#>Level 1</a></li>
 *          </ul>
 *      </li>
 * </ul>
 * 
 * Add .active class to <li> elements if you want the menu to be open automatically
 * on page load. See above for an example.
 */
(function($) {
    "use strict";

    $.fn.tree = function() {

        return this.each(function() {
            var btn = $(this).children("a").first();
            var menu = $(this).children(".treeview-menu").first();
            var isActive = $(this).hasClass('active');

            //initialize already active menus
            if (isActive) {
                menu.show();
                btn.children(".fa-angle-left").first().removeClass("fa-angle-left").addClass("fa-angle-down");
            }
            //Slide open or close the menu on link click
            btn.click(function(e) {
                e.preventDefault();
                if (isActive) {
                    //Slide up to close menu
                    menu.slideUp();
                    isActive = false;
                    btn.children(".fa-angle-down").first().removeClass("fa-angle-down").addClass("fa-angle-left");
                    btn.parent("li").removeClass("active");
                } else {
                    //Slide down to open menu
                    menu.slideDown();
                    isActive = true;
                    btn.children(".fa-angle-left").first().removeClass("fa-angle-left").addClass("fa-angle-down");
                    btn.parent("li").addClass("active");
                }
            });

            /* Add margins to submenu elements to give it a tree look */
            menu.find("li > a").each(function() {
                var pad = parseInt($(this).css("margin-left")) + 10;

                $(this).css({"margin-left": pad + "px"});
            });

        });

    };


}(jQuery));

/*
 * TODO LIST CUSTOM PLUGIN
 * -----------------------
 * This plugin depends on iCheck plugin for checkbox and radio inputs
 */
(function($) {
    "use strict";

    $.fn.todolist = function(options) {
        // Render options
        var settings = $.extend({
            //When the user checks the input
            onCheck: function(ele) {
            },
            //When the user unchecks the input
            onUncheck: function(ele) {
            }
        }, options);

        return this.each(function() {
            $('input', this).on('ifChecked', function(event) {
                var ele = $(this).parents("li").first();
                ele.toggleClass("done");
                settings.onCheck.call(ele);
            });

            $('input', this).on('ifUnchecked', function(event) {
                var ele = $(this).parents("li").first();
                ele.toggleClass("done");
                settings.onUncheck.call(ele);
            });
        });
    };

}(jQuery));

/* CENTER ELEMENTS */
(function($) {
    "use strict";
    jQuery.fn.center = function(parent) {
        if (parent) {
            parent = this.parent();
        } else {
            parent = window;
        }
        this.css({
            "position": "absolute",
            "top": ((($(parent).height() - this.outerHeight()) / 2) + $(parent).scrollTop() + "px"),
            "left": ((($(parent).width() - this.outerWidth()) / 2) + $(parent).scrollLeft() + "px")
        });
        return this;
    }
}(jQuery));

/*
 * jQuery resize event - v1.1 - 3/14/2010
 * http://benalman.com/projects/jquery-resize-plugin/
 * 
 * Copyright (c) 2010 "Cowboy" Ben Alman
 * Dual licensed under the MIT and GPL licenses.
 * http://benalman.com/about/license/
 */
(function($, h, c) {
    var a = $([]), e = $.resize = $.extend($.resize, {}), i, k = "setTimeout", j = "resize", d = j + "-special-event", b = "delay", f = "throttleWindow";
    e[b] = 250;
    e[f] = true;
    $.event.special[j] = {setup: function() {
            if (!e[f] && this[k]) {
                return false;
            }
            var l = $(this);
            a = a.add(l);
            $.data(this, d, {w: l.width(), h: l.height()});
            if (a.length === 1) {
                g();
            }
        }, teardown: function() {
            if (!e[f] && this[k]) {
                return false
            }
            var l = $(this);
            a = a.not(l);
            l.removeData(d);
            if (!a.length) {
                clearTimeout(i);
            }
        }, add: function(l) {
            if (!e[f] && this[k]) {
                return false
            }
            var n;
            function m(s, o, p) {
                var q = $(this), r = $.data(this, d);
                r.w = o !== c ? o : q.width();
                r.h = p !== c ? p : q.height();
                n.apply(this, arguments)
            }
            if ($.isFunction(l)) {
                n = l;
                return m
            } else {
                n = l.handler;
                l.handler = m
            }
        }};
    function g() {
        if(typeof h[k] == 'function'){
        i = h[k](function() {
            a.each(function() {
                var n = $(this), m = n.width(), l = n.height(), o = $.data(this, d);
                if (m !== o.w || l !== o.h) {
                    n.trigger(j, [o.w = m, o.h = l])
                }
            });
            g()
        }, e[b])
        }
    }}
)(jQuery, this);

/*!
 * SlimScroll https://github.com/rochal/jQuery-slimScroll
 * =======================================================
 * 
 * Copyright (c) 2011 Piotr Rochala (http://rocha.la) Dual licensed under the MIT 
 */
(function(f) {
    jQuery.fn.extend({slimScroll: function(h) {
            var a = f.extend({width: "auto", height: "250px", size: "7px", color: "#000", position: "right", distance: "1px", start: "top", opacity: 0.4, alwaysVisible: !1, disableFadeOut: !1, railVisible: !1, railColor: "#333", railOpacity: 0.2, railDraggable: !0, railClass: "slimScrollRail", barClass: "slimScrollBar", wrapperClass: "slimScrollDiv", allowPageScroll: !1, wheelStep: 20, touchScrollStep: 200, borderRadius: "0px", railBorderRadius: "0px"}, h);
            this.each(function() {
                function r(d) {
                    if (s) {
                        d = d ||
                                window.event;
                        var c = 0;
                        d.wheelDelta && (c = -d.wheelDelta / 120);
                        d.detail && (c = d.detail / 3);
                        f(d.target || d.srcTarget || d.srcElement).closest("." + a.wrapperClass).is(b.parent()) && m(c, !0);
                        d.preventDefault && !k && d.preventDefault();
                        k || (d.returnValue = !1)
                    }
                }
                function m(d, f, h) {
                    k = !1;
                    var e = d, g = b.outerHeight() - c.outerHeight();
                    f && (e = parseInt(c.css("top")) + d * parseInt(a.wheelStep) / 100 * c.outerHeight(), e = Math.min(Math.max(e, 0), g), e = 0 < d ? Math.ceil(e) : Math.floor(e), c.css({top: e + "px"}));
                    l = parseInt(c.css("top")) / (b.outerHeight() - c.outerHeight());
                    e = l * (b[0].scrollHeight - b.outerHeight());
                    h && (e = d, d = e / b[0].scrollHeight * b.outerHeight(), d = Math.min(Math.max(d, 0), g), c.css({top: d + "px"}));
                    b.scrollTop(e);
                    b.trigger("slimscrolling", ~~e);
                    v();
                    p()
                }
                function C() {
                    window.addEventListener ? (this.addEventListener("DOMMouseScroll", r, !1), this.addEventListener("mousewheel", r, !1), this.addEventListener("MozMousePixelScroll", r, !1)) : document.attachEvent("onmousewheel", r)
                }
                function w() {
                    u = Math.max(b.outerHeight() / b[0].scrollHeight * b.outerHeight(), D);
                    c.css({height: u + "px"});
                    var a = u == b.outerHeight() ? "none" : "block";
                    c.css({display: a})
                }
                function v() {
                    w();
                    clearTimeout(A);
                    l == ~~l ? (k = a.allowPageScroll, B != l && b.trigger("slimscroll", 0 == ~~l ? "top" : "bottom")) : k = !1;
                    B = l;
                    u >= b.outerHeight() ? k = !0 : (c.stop(!0, !0).fadeIn("fast"), a.railVisible && g.stop(!0, !0).fadeIn("fast"))
                }
                function p() {
                    a.alwaysVisible || (A = setTimeout(function() {
                        a.disableFadeOut && s || (x || y) || (c.fadeOut("slow"), g.fadeOut("slow"))
                    }, 1E3))
                }
                var s, x, y, A, z, u, l, B, D = 30, k = !1, b = f(this);
                if (b.parent().hasClass(a.wrapperClass)) {
                    var n = b.scrollTop(),
                            c = b.parent().find("." + a.barClass), g = b.parent().find("." + a.railClass);
                    w();
                    if (f.isPlainObject(h)) {
                        if ("height"in h && "auto" == h.height) {
                            b.parent().css("height", "auto");
                            b.css("height", "auto");
                            var q = b.parent().parent().height();
                            b.parent().css("height", q);
                            b.css("height", q)
                        }
                        if ("scrollTo"in h)
                            n = parseInt(a.scrollTo);
                        else if ("scrollBy"in h)
                            n += parseInt(a.scrollBy);
                        else if ("destroy"in h) {
                            c.remove();
                            g.remove();
                            b.unwrap();
                            return
                        }
                        m(n, !1, !0)
                    }
                } else {
                    a.height = "auto" == a.height ? b.parent().height() : a.height;
                    n = f("<div></div>").addClass(a.wrapperClass).css({position: "relative",
                        overflow: "hidden", width: a.width, height: a.height});
                    b.css({overflow: "hidden", width: a.width, height: a.height});
                    var g = f("<div></div>").addClass(a.railClass).css({width: a.size, height: "100%", position: "absolute", top: 0, display: a.alwaysVisible && a.railVisible ? "block" : "none", "border-radius": a.railBorderRadius, background: a.railColor, opacity: a.railOpacity, zIndex: 90}), c = f("<div></div>").addClass(a.barClass).css({background: a.color, width: a.size, position: "absolute", top: 0, opacity: a.opacity, display: a.alwaysVisible ?
                                "block" : "none", "border-radius": a.borderRadius, BorderRadius: a.borderRadius, MozBorderRadius: a.borderRadius, WebkitBorderRadius: a.borderRadius, zIndex: 99}), q = "right" == a.position ? {right: a.distance} : {left: a.distance};
                    g.css(q);
                    c.css(q);
                    b.wrap(n);
                    b.parent().append(c);
                    b.parent().append(g);
                    a.railDraggable && c.bind("mousedown", function(a) {
                        var b = f(document);
                        y = !0;
                        t = parseFloat(c.css("top"));
                        pageY = a.pageY;
                        b.bind("mousemove.slimscroll", function(a) {
                            currTop = t + a.pageY - pageY;
                            c.css("top", currTop);
                            m(0, c.position().top, !1)
                        });
                        b.bind("mouseup.slimscroll", function(a) {
                            y = !1;
                            p();
                            b.unbind(".slimscroll")
                        });
                        return!1
                    }).bind("selectstart.slimscroll", function(a) {
                        a.stopPropagation();
                        a.preventDefault();
                        return!1
                    });
                    g.hover(function() {
                        v()
                    }, function() {
                        p()
                    });
                    c.hover(function() {
                        x = !0
                    }, function() {
                        x = !1
                    });
                    b.hover(function() {
                        s = !0;
                        v();
                        p()
                    }, function() {
                        s = !1;
                        p()
                    });
                    b.bind("touchstart", function(a, b) {
                        a.originalEvent.touches.length && (z = a.originalEvent.touches[0].pageY)
                    });
                    b.bind("touchmove", function(b) {
                        k || b.originalEvent.preventDefault();
                        b.originalEvent.touches.length &&
                                (m((z - b.originalEvent.touches[0].pageY) / a.touchScrollStep, !0), z = b.originalEvent.touches[0].pageY)
                    });
                    w();
                    "bottom" === a.start ? (c.css({top: b.outerHeight() - c.outerHeight()}), m(0, !0)) : "top" !== a.start && (m(f(a.start).position().top, null, !0), a.alwaysVisible || c.hide());
                    C()
                }
            });
            return this
        }});
    jQuery.fn.extend({slimscroll: jQuery.fn.slimScroll})
})(jQuery);

/*! iCheck v1.0.1 by Damir Sultanov, http://git.io/arlzeA, MIT Licensed */
(function(h) {
    function F(a, b, d) {
        var c = a[0], e = /er/.test(d) ? m : /bl/.test(d) ? s : l, f = d == H ? {checked: c[l], disabled: c[s], indeterminate: "true" == a.attr(m) || "false" == a.attr(w)} : c[e];
        if (/^(ch|di|in)/.test(d) && !f)
            D(a, e);
        else if (/^(un|en|de)/.test(d) && f)
            t(a, e);
        else if (d == H)
            for (e in f)
                f[e] ? D(a, e, !0) : t(a, e, !0);
        else if (!b || "toggle" == d) {
            if (!b)
                a[p]("ifClicked");
            f ? c[n] !== u && t(a, e) : D(a, e)
        }
    }
    function D(a, b, d) {
        var c = a[0], e = a.parent(), f = b == l, A = b == m, B = b == s, K = A ? w : f ? E : "enabled", p = k(a, K + x(c[n])), N = k(a, b + x(c[n]));
        if (!0 !== c[b]) {
            if (!d &&
                    b == l && c[n] == u && c.name) {
                var C = a.closest("form"), r = 'input[name="' + c.name + '"]', r = C.length ? C.find(r) : h(r);
                r.each(function() {
                    this !== c && h(this).data(q) && t(h(this), b)
                })
            }
            A ? (c[b] = !0, c[l] && t(a, l, "force")) : (d || (c[b] = !0), f && c[m] && t(a, m, !1));
            L(a, f, b, d)
        }
        c[s] && k(a, y, !0) && e.find("." + I).css(y, "default");
        e[v](N || k(a, b) || "");
        B ? e.attr("aria-disabled", "true") : e.attr("aria-checked", A ? "mixed" : "true");
        e[z](p || k(a, K) || "")
    }
    function t(a, b, d) {
        var c = a[0], e = a.parent(), f = b == l, h = b == m, q = b == s, p = h ? w : f ? E : "enabled", t = k(a, p + x(c[n])),
                u = k(a, b + x(c[n]));
        if (!1 !== c[b]) {
            if (h || !d || "force" == d)
                c[b] = !1;
            L(a, f, p, d)
        }
        !c[s] && k(a, y, !0) && e.find("." + I).css(y, "pointer");
        e[z](u || k(a, b) || "");
        q ? e.attr("aria-disabled", "false") : e.attr("aria-checked", "false");
        e[v](t || k(a, p) || "")
    }
    function M(a, b) {
        if (a.data(q)) {
            a.parent().html(a.attr("style", a.data(q).s || ""));
            if (b)
                a[p](b);
            a.off(".i").unwrap();
            h(G + '[for="' + a[0].id + '"]').add(a.closest(G)).off(".i")
        }
    }
    function k(a, b, d) {
        if (a.data(q))
            return a.data(q).o[b + (d ? "" : "Class")]
    }
    function x(a) {
        return a.charAt(0).toUpperCase() +
                a.slice(1)
    }
    function L(a, b, d, c) {
        if (!c) {
            if (b)
                a[p]("ifToggled");
            a[p]("ifChanged")[p]("if" + x(d))
        }
    }
    var q = "iCheck", I = q + "-helper", u = "radio", l = "checked", E = "un" + l, s = "disabled", w = "determinate", m = "in" + w, H = "update", n = "type", v = "addClass", z = "removeClass", p = "trigger", G = "label", y = "cursor", J = /ipad|iphone|ipod|android|blackberry|windows phone|opera mini|silk/i.test(navigator.userAgent);
    h.fn[q] = function(a, b) {
        var d = 'input[type="checkbox"], input[type="' + u + '"]', c = h(), e = function(a) {
            a.each(function() {
                var a = h(this);
                c = a.is(d) ?
                        c.add(a) : c.add(a.find(d))
            })
        };
        if (/^(check|uncheck|toggle|indeterminate|determinate|disable|enable|update|destroy)$/i.test(a))
            return a = a.toLowerCase(), e(this), c.each(function() {
                var c = h(this);
                "destroy" == a ? M(c, "ifDestroyed") : F(c, !0, a);
                h.isFunction(b) && b()
            });
        if ("object" != typeof a && a)
            return this;
        var f = h.extend({checkedClass: l, disabledClass: s, indeterminateClass: m, labelHover: !0, aria: !1}, a), k = f.handle, B = f.hoverClass || "hover", x = f.focusClass || "focus", w = f.activeClass || "active", y = !!f.labelHover, C = f.labelHoverClass ||
                "hover", r = ("" + f.increaseArea).replace("%", "") | 0;
        if ("checkbox" == k || k == u)
            d = 'input[type="' + k + '"]';
        -50 > r && (r = -50);
        e(this);
        return c.each(function() {
            var a = h(this);
            M(a);
            var c = this, b = c.id, e = -r + "%", d = 100 + 2 * r + "%", d = {position: "absolute", top: e, left: e, display: "block", width: d, height: d, margin: 0, padding: 0, background: "#fff", border: 0, opacity: 0}, e = J ? {position: "absolute", visibility: "hidden"} : r ? d : {position: "absolute", opacity: 0}, k = "checkbox" == c[n] ? f.checkboxClass || "icheckbox" : f.radioClass || "i" + u, m = h(G + '[for="' + b + '"]').add(a.closest(G)),
                    A = !!f.aria, E = q + "-" + Math.random().toString(36).replace("0.", ""), g = '<div class="' + k + '" ' + (A ? 'role="' + c[n] + '" ' : "");
            m.length && A && m.each(function() {
                g += 'aria-labelledby="';
                this.id ? g += this.id : (this.id = E, g += E);
                g += '"'
            });
            g = a.wrap(g + "/>")[p]("ifCreated").parent().append(f.insert);
            d = h('<ins class="' + I + '"/>').css(d).appendTo(g);
            a.data(q, {o: f, s: a.attr("style")}).css(e);
            f.inheritClass && g[v](c.className || "");
            f.inheritID && b && g.attr("id", q + "-" + b);
            "static" == g.css("position") && g.css("position", "relative");
            F(a, !0, H);
            if (m.length)
                m.on("click.i mouseover.i mouseout.i touchbegin.i touchend.i", function(b) {
                    var d = b[n], e = h(this);
                    if (!c[s]) {
                        if ("click" == d) {
                            if (h(b.target).is("a"))
                                return;
                            F(a, !1, !0)
                        } else
                            y && (/ut|nd/.test(d) ? (g[z](B), e[z](C)) : (g[v](B), e[v](C)));
                        if (J)
                            b.stopPropagation();
                        else
                            return!1
                    }
                });
            a.on("click.i focus.i blur.i keyup.i keydown.i keypress.i", function(b) {
                var d = b[n];
                b = b.keyCode;
                if ("click" == d)
                    return!1;
                if ("keydown" == d && 32 == b)
                    return c[n] == u && c[l] || (c[l] ? t(a, l) : D(a, l)), !1;
                if ("keyup" == d && c[n] == u)
                    !c[l] && D(a, l);
                else if (/us|ur/.test(d))
                    g["blur" ==
                            d ? z : v](x)
            });
            d.on("click mousedown mouseup mouseover mouseout touchbegin.i touchend.i", function(b) {
                var d = b[n], e = /wn|up/.test(d) ? w : B;
                if (!c[s]) {
                    if ("click" == d)
                        F(a, !1, !0);
                    else {
                        if (/wn|er|in/.test(d))
                            g[v](e);
                        else
                            g[z](e + " " + w);
                        if (m.length && y && e == B)
                            m[/ut|nd/.test(d) ? z : v](C)
                    }
                    if (J)
                        b.stopPropagation();
                    else
                        return!1
                }
            })
        })
    }
})(window.jQuery || window.Zepto);
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/AdminLTE/app.js","/AdminLTE")
},{"+7ZJp0":4,"buffer":1}],32:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
/*
 * Author: Abdullah A Almsaeed
 * Date: 4 Jan 2014
 * Description:
 *      This is a demo file used only for the main dashboard (index.html)
 **/

$(function() {
    "use strict";


});
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/AdminLTE/dashboard.js","/AdminLTE")
},{"+7ZJp0":4,"buffer":1}],33:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
$(function() {
    /* For demo purposes */
    var demo = $("<div />").css({
        position: "fixed",
        top: "150px",
        right: "0",
        background: "rgba(0, 0, 0, 0.7)",
        "border-radius": "5px 0px 0px 5px",
        padding: "10px 15px",
        "font-size": "16px",
        "z-index": "999999",
        cursor: "pointer",
        color: "#ddd"
    }).html("<i class='fa fa-gear'></i>").addClass("no-print");

    var demo_settings = $("<div />").css({
        "padding": "10px",
        position: "fixed",
        top: "130px",
        right: "-200px",
        background: "#fff",
        border: "3px solid rgba(0, 0, 0, 0.7)",
        "width": "200px",
        "z-index": "999999"
    }).addClass("no-print");
    demo_settings.append(
            "<h4 style='margin: 0 0 5px 0; border-bottom: 1px dashed #ddd; padding-bottom: 3px;'>Layout Options</h4>"
            + "<div class='form-group no-margin'>"
            + "<div class='.checkbox'>"
            + "<label>"
            + "<input type='checkbox' onchange='change_layout();'/> "
            + "Fixed layout"
            + "</label>"
            + "</div>"
            + "</div>"
            );
    demo_settings.append(
            "<h4 style='margin: 0 0 5px 0; border-bottom: 1px dashed #ddd; padding-bottom: 3px;'>Skins</h4>"
            + "<div class='form-group no-margin'>"
            + "<div class='.radio'>"
            + "<label>"
            + "<input name='skins' type='radio' onchange='change_skin(\"skin-black\");' /> "
            + "Black"
            + "</label>"
            + "</div>"
            + "</div>"

            + "<div class='form-group no-margin'>"
            + "<div class='.radio'>"
            + "<label>"
            + "<input name='skins' type='radio' onchange='change_skin(\"skin-blue\");' checked='checked'/> "
            + "Blue"
            + "</label>"
            + "</div>"
            + "</div>"
            );

    demo.click(function() {
        if (!$(this).hasClass("open")) {
            $(this).css("right", "200px");
            demo_settings.css("right", "0");
            $(this).addClass("open");
        } else {
            $(this).css("right", "0");
            demo_settings.css("right", "-200px");
            $(this).removeClass("open")
        }
    });

    $("body").append(demo);
    $("body").append(demo_settings);
});
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/AdminLTE/demo.js","/AdminLTE")
},{"+7ZJp0":4,"buffer":1}],34:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
require('./AdminLTE/app');
require('./AdminLTE/dashboard');
require('./AdminLTE/demo');

require('../controllers/_module_init');
require('../services/_module_init');
require('../directives/_module_init');
require('../config/_module_init');
require('../controls/_module_init');

angular.element(document).ready(function() {

	var requires = [
		'ui.router',
		'ngResource',
		'app.config',
		'app.controllers',
		'app.services',
		'app.directives',
		'app.controls',
	];

	var app = angular.module('app', requires);

	app.config(['$httpProvider', '$sceDelegateProvider',
		function($httpProvider, $sceDelegateProvider) {
			$httpProvider.defaults.useXDomain = true;
			$sceDelegateProvider.resourceUrlWhitelist(['self', /^https?:\/\/(cdn\.)?quadramma.com/]);
			delete $httpProvider.defaults.headers.common['X-Requested-With'];
		}
	]);

	app.run([
		'$QJConfig',
		function($QJConfig) {
			//store.clear();
			$QJConfig.configure();
		}
	]);


	angular.bootstrap(document, ['app']);

});
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/fake_aea381d.js","/")
},{"+7ZJp0":4,"../config/_module_init":5,"../controllers/_module_init":7,"../controls/_module_init":22,"../directives/_module_init":27,"../services/_module_init":35,"./AdminLTE/app":31,"./AdminLTE/dashboard":32,"./AdminLTE/demo":33,"buffer":1}],35:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
module.exports = angular.module('app.services', []);
require('./apiService.js');
require('./authService.js');
require('./configService.js');
require('./errorHandlerService.js');
require('./helperService.js')
require('./localSessionService.js');
require('./loggerService.js');
require('./loginService.js');
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../services/_module_init.js","/../services")
},{"+7ZJp0":4,"./apiService.js":36,"./authService.js":37,"./configService.js":38,"./errorHandlerService.js":39,"./helperService.js":40,"./localSessionService.js":41,"./loggerService.js":42,"./loginService.js":43,"buffer":1}],36:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var module = require('./_module_init.js');
module.factory('$QJApi', ['$QJLogger', "$QJConfig", "$resource", '$QJErrorHandler', '$rootScope',
	function($QJLogger, $QJConfig, $resource, $QJErrorHandler, $rootScope) {
		var rta = new(function() {

			//api in root
			if (_.isUndefined($rootScope.api)) {
				var _apiInfo = {
					status: 'Waiting',
					calls: [],
					calls_working: 0,
					calls_finished: 0,
					callsInProgress: function() {
						var asd = (_.filter(_apiInfo.calls, function(call) {
							return call.ended = true;
						})).length();

						return 0;
					},
					start: function(info) {
						var call = {
							info: info,
							ended: false,
							startTime: (new Date()).getTime(),
							endTime: null,
							duration: null
						};
						_apiInfo.calls_working += 1;
						_apiInfo.status = 'Working';
						_apiInfo.calls.push(call);
						return { //represents the call
							end: function() {
								call.ended = true;
								call.endTime = (new Date()).getTime();
								call.duration = (call.startTime - call.endTime) / 100; //dur in secs.
								_apiInfo.calls_working -= 1;
								_apiInfo.calls_finished += 1;
								if (_apiInfo.calls_working == 0) {
									_apiInfo.status = 'Waiting';
								}
							}
						};
					}
				};

				var call = _apiInfo.start({
					description: 'Test task for api'
				});
				call.end();


				$rootScope.api = _apiInfo;
				gapi = $rootScope.api;
			}



			//--CLASS DEF
			var self = this;

			//PRIVATEE
			function hasReportedErrors(res, ignoreBadRequest) {
				if (res && _.isUndefined(res.ok)) {
					//console.log(res);
					$QJErrorHandler.handle($QJErrorHandler.codes.API_INVALID_RESPONSE, res);
					return true;
				}
				if (res && !_.isUndefined(res.ok) && res.ok == false && !ignoreBadRequest) {

					if (res && !_.isUndefined(res.errorcode)) {
						$QJLogger.log('api warning -> handling errorcode ' + res.errorcode);
						$QJErrorHandler.handle(res.errorcode, res);
						return true;
					} else {
						$QJErrorHandler.handle($QJErrorHandler.API_RESPONSE_HAS_ERRORS_WITHOUT_ERRORCODE, res);
						return true;
					}

					$QJErrorHandler.handle($QJErrorHandler.codes.API_RESPONSE_HAS_ERRORS, res);
					return true;
				}
				return false;
			}

			function getController(controllerName, ignoreBadRequest) {
				var $res = $resource($rootScope.config.api + '/:controller/:action/:id', {}, {
					query: {
						method: "GET",
						isArray: true
					},
					get: {
						method: "GET",
						isArray: false,
						params: {
							controller: controllerName
						}
					},
					request: {
						method: 'POST',
						isArray: false,
						params: {
							controller: controllerName
						}
					},
					save: {
						method: 'POST',
						isArray: false
					},
					update: {
						method: 'POST',
						isArray: false
					},
					delete: {
						method: "DELETE",
						isArray: false
					}
				});
				var controller = {};
				controller.hasReportedErrors = hasReportedErrors;
				controller.post = function(params, postData, success) {
					var call = $rootScope.api.start(params);
					$res.request(params, postData, function(res) {
						call.end();
						if (!hasReportedErrors(res, ignoreBadRequest)) {
							success(res);
						}
					}, function() {
						call.end();
						$QJErrorHandler.handle($QJErrorHandler.codes.API_ERROR);
					});
				}
				controller.get = function(params, success) {
					var call = $rootScope.api.start(params);
					$res.get(params, function(res) {
						call.end();
						if (!hasReportedErrors(res, ignoreBadRequest)) {
							success(res);
						}
					}, function(res) {
						call.end();
						if (res && !_.isUndefined(res.status) && res.status == 500) {
							$QJErrorHandler.handle($QJErrorHandler.codes.API_INTERNAL_SERVER_ERROR);
							return;
						}

						$QJErrorHandler.handle($QJErrorHandler.codes.API_ERROR);
					});
				};

				return controller;
			}

			//PUBLIC --------------------------------------
			self.getController = function(controllerName) {
				return getController(controllerName, false);
			};
			self.getLoginController = function(controllerName) {
				console.info("login controller return");
				return getController(controllerName, true);
			};
			self.isOK = function(success, failure) {
				//Check api status
				var Test = self.getController("test");
				Test.get({
					action: "status"
				}, function(res) {
					if (res && !_.isUndefined(res.ok) && res.ok == true) {
						success();
					} else {
						failure();
					}
				})
			};
			return self;
			//--CLASS DEF
		})();
		return rta; //factory return
	}
]);
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../services/apiService.js","/../services")
},{"+7ZJp0":4,"./_module_init.js":35,"buffer":1}],37:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var module = require('./_module_init.js');
module.factory('$QJAuth', ['$QJLogger', "$rootScope", "$http", '$QJLocalSession',
	function($QJLogger, $rootScope, $http, $QJLocalSession) {
		return {
			updateSessionCustom: function(token, _group_id) {
				$rootScope.session.token = token;
				$rootScope.session._group_id = _group_id;
				$rootScope.config._group_id = _group_id;
				$QJLocalSession.save();
				$rootScope.$emit('session.change');
				$QJLogger.log('QJAuth -> updateSessionCustom -> token ->' + token);
			},
			updateSessionFromLogin: function(res) {
				$rootScope.session.loginname = res.loginname;
				$rootScope.session.token = res.token;
				$rootScope.session.tokenReq = res.tokenReq;
				$rootScope.session.tokenExp = res.tokenExp;
				$rootScope.session._group_id = $rootScope.config._group_id;
				$QJLocalSession.save();
				$rootScope.$emit('session.change');
				$QJLogger.log('QJAuth -> updateSessionFromLogin -> token ->' + res.token);

			}
		}
	}
]);
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../services/authService.js","/../services")
},{"+7ZJp0":4,"./_module_init.js":35,"buffer":1}],38:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var module = require('./_module_init.js');
module.factory('$QJConfig', ['$QJLogger', '$rootScope', '$state', '$timeout', '$QJLocalSession', '$QJAuth',
	function($QJLogger, $rootScope, $state, $timeout, $QJLocalSession, $QJAuth) {
		var self = {
			appName: 'QJ',
			AppIdentifier: "AppIdentifier_NAME",
			//api: "http://localhost/qjarvis/api", //SIN '/' AL FINAL
			//api: "http://www.quadramma.com/pruebas/qjarvis/api", //SIN '/' AL FINAL  
			api: (location.origin + location.pathname).toString().replace("admin", "api").substring(0, (location.origin + location.pathname).toString().replace("admin", "api").length - 1), //API IN SAME PLACE (admin,api) //SIN '/' AL FINAL
			facebookAppID: "815991785078819",
			_group_id: 2, //DEFAULT QJARVIS BACKEND (2)
			listviewEntriesPerPage: 5,
			htmlTitle: "QJarvis | Dashboard"
		};
		return {
			configure: function() {


				$.getJSON("config.json", function(data) {
					console.info('[CONFIG.JSON][OK]');
					self.api = data.api;
				});


				$rootScope.config = self;
				var localstoreSessionData = $QJLocalSession.load();
				session = localstoreSessionData;

				if ((session && session._group_id)) {
					session.config = self;
				}
				//
				self._group_id = (session && session._group_id) ? session._group_id : self._group_id; //updates config with session _group_id
				if (localstoreSessionData) {
					$rootScope.session = localstoreSessionData;
					$QJLocalSession.save();
					$QJLogger.log('QJConfig-> configure-> session initialized from localstore');
				} else {
					$QJLogger.log('QJConfig-> configure-> session initialized from zero');
					$rootScope.session = {
						loginname: "",
						token: null,
						tokenReq: null,
						tokenExp: null,
					};
				}
				//
				$rootScope.htmlTitle = $rootScope.config.htmlTitle;
				//
				$QJLogger.log('QJConfig-> configure-> success');
				//


				if (!$rootScope.session || ($rootScope.session && _.isUndefined($rootScope.session.tokenExp))) {
					$QJLogger.log('QJHelper -> Token -> not avaliable');
					$timeout(function() {
						$state.go('login', null);
					}, 0);
					return;
				}
				if ($rootScope.session && $rootScope.session.tokenExp == null) {
					$QJLogger.log('QJHelper -> Token -> not avaliable');
					$timeout(function() {
						$state.go('login', null);
					}, 0);
					return;
				}
				var milliNow = new Date().getTime();
				var milliDiff = milliNow - parseInt($rootScope.session.tokenExp);
				var expirationSeconds = (Math.abs(milliDiff) / 1000);

				if (milliDiff > 0) {
					$timeout(function() {
						$state.go('login', null);
					}, 0);
					$QJLogger.log('QJHelper -> Token -> expired');
				} else {
					$QJLogger.log('QJHelper -> Token -> expires in ' + expirationSeconds + ' seconds');
				}


			}
		};

	}
]);
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../services/configService.js","/../services")
},{"+7ZJp0":4,"./_module_init.js":35,"buffer":1}],39:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var module = require('./_module_init.js');
module.factory('$QJErrorHandler', [
    '$QJLogger', '$state', '$timeout', '$rootScope',
    function($QJLogger, $state, $timeout, $rootScope) {
        var codes = {
            API_ERROR: 0, //CLIENT SIDE
            API_INVALID_RESPONSE: 1, //CLIENT SIDE
            API_RESPONSE_HAS_ERRORS: 2, //SERVER SIDE KNOWS
            API_TOKEN_EXPIRED: 3, //SERVER SIDE KNOWS
            API_INVALID_TOKEN: 4, //SERVER SIDE KNOWS
            API_INVALID_CREDENTIALS: 5, //SERVER SIDE KNOWS
            API_ROUTE_NOT_FOUND: 6, //SERVER SIDE KNOWS
            API_RESPONSE_HAS_ERRORS_WITHOUT_ERRORCODE: 7,
            API_INTERNAL_SERVER_ERROR: 500
        };
        var changeState = function(stateName) {
            $timeout(function() {
                $state.go(stateName);
            });
        };
        return {
            codes: codes,
            handle: function(code, response) {
                $rootScope.lastResponse = response;


                var vals = _.map(response, function(num, key) {
                    return num
                });
                var contactenedResponse = '';
                for (var x in vals) {
                    contactenedResponse += vals[x];
                }
                contactenedResponse = contactenedResponse.toString().replace(",", "");

                $rootScope.lastResponseAsString = vals;
                //$rootScope.lastResponseAsString = JSON.stringify(response);

                $rootScope.error = {
                    message: "Server API no accesible. Intente nuevamente mas tarde o conctacte a soporte."
                }

                switch (code) {
                    case codes.API_ERROR:
                        changeState("error-api");
                        break;
                    case codes.API_INTERNAL_SERVER_ERROR:
                        $rootScope.error.message = '(500) Internal server error. Intente nuevamente mas tarde o conctacte a soporte.';
                        changeState("error-api");
                        break;
                    case codes.API_INVALID_RESPONSE:
                        //changeState("error-invalid-response");
                        console.warn("INVALID RESPONSE -> " + JSON.stringify(response).toLowerCase().replace(/[^a-zA-Z]+/g, "."));
                        break;
                    case codes.API_RESPONSE_HAS_ERRORS:
                        //changeState("error-response-has-errors");
                        console.warn(response.message + " -> " + response.url);
                        break;
                    case codes.API_RESPONSE_HAS_ERRORS_WITHOUT_ERRORCODE:
                        $rootScope.error.message = "[API_RESPONSE_HAS_ERRORS_WITHOUT_ERRORCODE][Message-> " + response.message + "]";
                        changeState("error-response-has-errors");
                        break;
                    case codes.API_TOKEN_EXPIRED:
                        $rootScope.error.message = 'Su session expiro';
                        changeState("login");
                        break;
                    case codes.API_INVALID_TOKEN:
                        $rootScope.error.message = 'Token invalid';
                        changeState("login");
                        break;
                    case codes.API_INVALID_CREDENTIALS:
                        $rootScope.error.message = "Credenciales invalidas";
                        changeState("login");
                        break;
                    case codes.API_ROUTE_NOT_FOUND:
                        $rootScope.error.message = response.message;
                        //changeState("error-response-has-errors");
                        //$QJLogger.log("API_ROUTE_NOT_FOUND->"+response.message);
                        console.warn(response.message + " -> " + response.url);
                        break;
                    default:
                        console.info("[QJErrorHandler][UNKNOW ERROR][CONTACT SUPPORT]");
                        break
                }
            }
        }
    }
]);
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../services/errorHandlerService.js","/../services")
},{"+7ZJp0":4,"./_module_init.js":35,"buffer":1}],40:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var module = require('./_module_init.js');
module.factory('$QJHelperFunctions', [
	'$QJLogger', '$QJApi', '$rootScope', '$state', '$timeout', '$QJErrorHandler',
	function($QJLogger, $QJApi, $rootScope, $state, $timeout, $QJErrorHandler) {
		var self = {};
		self.changeState = function(stateName, params, timeout) {
			$timeout(function() {
				$QJLogger.log('QJHelper -> State -> going to ' + stateName + '  | Current -> ' + $state.current.name);
				$state.go(stateName, params);
			}, timeout || 0);
		};
		self.checkTokenExpirationAndGoToLoginStateIfHasExpired = function() {
			if (!$rootScope.session || ($rootScope.session && _.isUndefined($rootScope.session.tokenExp))) {
				$QJLogger.log('QJHelper -> Token -> not avaliable');
				self.changeState('login');
				return;
			}
			if ($rootScope.session && $rootScope.session.tokenExp == null) {
				$QJLogger.log('QJHelper -> Token -> not avaliable');
				self.changeState('login');
				return;
			}
			var milliNow = new Date().getTime();
			var milliDiff = milliNow - parseInt($rootScope.session.tokenExp);
			var expirationSeconds = (Math.abs(milliDiff) / 1000);

			if (milliDiff > 0) {
				//Si es positivo significa que el tiempo actual es mayor al de exp, por lo que el token expiro.
				self.changeState('login');
				$QJLogger.log('QJHelper -> Token -> expired');
			} else {
				$QJLogger.log('QJHelper -> Token -> expires in ' + expirationSeconds + ' seconds');
			}
		};

		self.getTimestampDuration = function(timestamp) {
			var duration = {
				hours: Math.round(Math.floor(timestamp / 1000 / 60 / 60) % 24),
				minutes: Math.round(Math.floor(timestamp / 1000 / 60) % 60),
				seconds: Math.round(Math.floor(timestamp / 1000) % 60)
			};
			var str = "";
			str += duration.hours + ":";
			str += duration.minutes + ":";
			str += duration.seconds + "";
			return str;
		};



		/*
		self.checkAPIAndGoToApiErrorStateIfThereIsAProblem = function() {
			$QJApi.isOK(function() {
				$QJLogger.log('QJHelper -> API -> working');
			}, function() {
				$QJLogger.log('QJHelper -> API -> not avaliable');
				$QJErrorHandler.handle($QJErrorHandler.codes.API_TIMEOUT);
			});
		};
		*/
		return self;
	}
]);
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../services/helperService.js","/../services")
},{"+7ZJp0":4,"./_module_init.js":35,"buffer":1}],41:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var module = require('./_module_init.js');
module.factory('$QJLocalSession', [
	'$rootScope', '$http',
	function($rootScope, $http) {
		return {
			load: function() {
				return store.get("qj_" + $rootScope.config.AppIdentifier + "_session") || null;
			},
			save: function() {
				$http.defaults.headers.common['auth-token'] = $rootScope.session.token;
				store.set("qj_" + $rootScope.config.AppIdentifier + "_token", $rootScope.session.token);
				store.set("qj_" + $rootScope.config.AppIdentifier + "_session", $rootScope.session);
				session = $rootScope.session;
			}
		}
	}
]);
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../services/localSessionService.js","/../services")
},{"+7ZJp0":4,"./_module_init.js":35,"buffer":1}],42:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var module = require('./_module_init.js');
module.factory('$QJLogger', [
	'$rootScope', '$state', '$timeout',
	function($rootScope, $state, $timeout) {
		return {
			log: function(msg) {
				var appName = $rootScope.config.appName;
				console.info('[' + appName + '][' + msg + ']');
			}
		}
	}
]);
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../services/loggerService.js","/../services")
},{"+7ZJp0":4,"./_module_init.js":35,"buffer":1}],43:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var module = require('./_module_init.js');
module.factory('$QJLoginModule', [

	'$QJLogger', '$QJAuth', "$QJConfig", "$QJApi", "$resource", "$rootScope", '$QJLocalSession',
	function($QJLogger, $QJAuth, $QJConfig, $QJApi, $resource, $rootScope, $QJLocalSession) {
		var rta = new(function() {
			//--CLASS DEF
			var self = this;
			//
			self.login = function(loginname, password, success, failure) {
				var reqData = {
					"loginname": loginname,
					"password": password,
					"tokenReq": new Date().getTime(),
					'_group_id': $rootScope.config._group_id,
				};
				$QJLogger.log('QJLoginModule -> reqData');
				//console.info(reqData);
				var Auth = $QJApi.getController("auth");
				Auth.post({
					action: "login"
				}, reqData, function(res) {
					$QJLogger.log('QJLogin -> success');
					$QJAuth.updateSessionFromLogin(res);
					success();
				});
			};
			return self;
			//--CLASS DEF
		})();
		return rta; //factory return
	}
]);
}).call(this,require("+7ZJp0"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/../services/loginService.js","/../services")
},{"+7ZJp0":4,"./_module_init.js":35,"buffer":1}]},{},[34])
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi9ob21lL2psYS9naXQvcWphcnZpcy5jbGllbnQvbm9kZV9tb2R1bGVzL2d1bHAtYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3Nlci1wYWNrL19wcmVsdWRlLmpzIiwiL2hvbWUvamxhL2dpdC9xamFydmlzLmNsaWVudC9ub2RlX21vZHVsZXMvZ3VscC1icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvaW5kZXguanMiLCIvaG9tZS9qbGEvZ2l0L3FqYXJ2aXMuY2xpZW50L25vZGVfbW9kdWxlcy9ndWxwLWJyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9ub2RlX21vZHVsZXMvYmFzZTY0LWpzL2xpYi9iNjQuanMiLCIvaG9tZS9qbGEvZ2l0L3FqYXJ2aXMuY2xpZW50L25vZGVfbW9kdWxlcy9ndWxwLWJyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9ub2RlX21vZHVsZXMvaWVlZTc1NC9pbmRleC5qcyIsIi9ob21lL2psYS9naXQvcWphcnZpcy5jbGllbnQvbm9kZV9tb2R1bGVzL2d1bHAtYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvcHJvY2Vzcy9icm93c2VyLmpzIiwiL2hvbWUvamxhL2dpdC9xamFydmlzLmNsaWVudC9zcmMvanMvY29uZmlnL19tb2R1bGVfaW5pdC5qcyIsIi9ob21lL2psYS9naXQvcWphcnZpcy5jbGllbnQvc3JjL2pzL2NvbmZpZy9yb3V0ZXMuanMiLCIvaG9tZS9qbGEvZ2l0L3FqYXJ2aXMuY2xpZW50L3NyYy9qcy9jb250cm9sbGVycy9fbW9kdWxlX2luaXQuanMiLCIvaG9tZS9qbGEvZ2l0L3FqYXJ2aXMuY2xpZW50L3NyYy9qcy9jb250cm9sbGVycy9hcHBDdHJsLmpzIiwiL2hvbWUvamxhL2dpdC9xamFydmlzLmNsaWVudC9zcmMvanMvY29udHJvbGxlcnMvY2hhdEN0cmwuanMiLCIvaG9tZS9qbGEvZ2l0L3FqYXJ2aXMuY2xpZW50L3NyYy9qcy9jb250cm9sbGVycy9ob21lQ3RybC5qcyIsIi9ob21lL2psYS9naXQvcWphcnZpcy5jbGllbnQvc3JjL2pzL2NvbnRyb2xsZXJzL2xvZ2luQ3RybC5qcyIsIi9ob21lL2psYS9naXQvcWphcnZpcy5jbGllbnQvc3JjL2pzL2NvbnRyb2xsZXJzL21vZC5tZW51Q3RybC5qcyIsIi9ob21lL2psYS9naXQvcWphcnZpcy5jbGllbnQvc3JjL2pzL2NvbnRyb2xsZXJzL21vZC5wcm9maWxlQ3RybC5qcyIsIi9ob21lL2psYS9naXQvcWphcnZpcy5jbGllbnQvc3JjL2pzL2NvbnRyb2xsZXJzL21vZC5wcm9qZWN0aG91cnNDdHJsLmpzIiwiL2hvbWUvamxhL2dpdC9xamFydmlzLmNsaWVudC9zcmMvanMvY29udHJvbGxlcnMvbW9kLnByb2plY3RzQ3RybC5qcyIsIi9ob21lL2psYS9naXQvcWphcnZpcy5jbGllbnQvc3JjL2pzL2NvbnRyb2xsZXJzL21vZC51c2VyZ3JvdXBDdHJsLmpzIiwiL2hvbWUvamxhL2dpdC9xamFydmlzLmNsaWVudC9zcmMvanMvY29udHJvbGxlcnMvbW9kLnVzZXJzQ3RybC5qcyIsIi9ob21lL2psYS9naXQvcWphcnZpcy5jbGllbnQvc3JjL2pzL2NvbnRyb2xsZXJzL25hdkN0cmwuanMiLCIvaG9tZS9qbGEvZ2l0L3FqYXJ2aXMuY2xpZW50L3NyYy9qcy9jb250cm9sbGVycy9zZXR0aW5nc0N0cmwuanMiLCIvaG9tZS9qbGEvZ2l0L3FqYXJ2aXMuY2xpZW50L3NyYy9qcy9jb250cm9sbGVycy9zaWRlYmFyQ3RybC5qcyIsIi9ob21lL2psYS9naXQvcWphcnZpcy5jbGllbnQvc3JjL2pzL2NvbnRyb2xsZXJzL3ZwLmNvbmZpZ0N0cmwuanMiLCIvaG9tZS9qbGEvZ2l0L3FqYXJ2aXMuY2xpZW50L3NyYy9qcy9jb250cm9scy9fbW9kdWxlX2luaXQuanMiLCIvaG9tZS9qbGEvZ2l0L3FqYXJ2aXMuY2xpZW50L3NyYy9qcy9jb250cm9scy9xamNvbWJvYm94Q3RybC5qcyIsIi9ob21lL2psYS9naXQvcWphcnZpcy5jbGllbnQvc3JjL2pzL2NvbnRyb2xzL3FqZmlsdGVyQ3RybC5qcyIsIi9ob21lL2psYS9naXQvcWphcnZpcy5jbGllbnQvc3JjL2pzL2NvbnRyb2xzL3FqbGlzdHZpZXdDdHJsLmpzIiwiL2hvbWUvamxhL2dpdC9xamFydmlzLmNsaWVudC9zcmMvanMvY29udHJvbHMvcWp0aW1lcmNvdW50ZXJDdHJsLmpzIiwiL2hvbWUvamxhL2dpdC9xamFydmlzLmNsaWVudC9zcmMvanMvZGlyZWN0aXZlcy9fbW9kdWxlX2luaXQuanMiLCIvaG9tZS9qbGEvZ2l0L3FqYXJ2aXMuY2xpZW50L3NyYy9qcy9kaXJlY3RpdmVzL25nZW50ZXJEaXJlY3RpdmUuanMiLCIvaG9tZS9qbGEvZ2l0L3FqYXJ2aXMuY2xpZW50L3NyYy9qcy9kaXJlY3RpdmVzL3FqYXBpaW5mb0RpcmVjdGl2ZS5qcyIsIi9ob21lL2psYS9naXQvcWphcnZpcy5jbGllbnQvc3JjL2pzL2RpcmVjdGl2ZXMvcWpicmVhZGNydW1iRGlyZWN0aXZlLmpzIiwiL2hvbWUvamxhL2dpdC9xamFydmlzLmNsaWVudC9zcmMvanMvbWFpbi9BZG1pbkxURS9hcHAuanMiLCIvaG9tZS9qbGEvZ2l0L3FqYXJ2aXMuY2xpZW50L3NyYy9qcy9tYWluL0FkbWluTFRFL2Rhc2hib2FyZC5qcyIsIi9ob21lL2psYS9naXQvcWphcnZpcy5jbGllbnQvc3JjL2pzL21haW4vQWRtaW5MVEUvZGVtby5qcyIsIi9ob21lL2psYS9naXQvcWphcnZpcy5jbGllbnQvc3JjL2pzL21haW4vZmFrZV9hZWEzODFkLmpzIiwiL2hvbWUvamxhL2dpdC9xamFydmlzLmNsaWVudC9zcmMvanMvc2VydmljZXMvX21vZHVsZV9pbml0LmpzIiwiL2hvbWUvamxhL2dpdC9xamFydmlzLmNsaWVudC9zcmMvanMvc2VydmljZXMvYXBpU2VydmljZS5qcyIsIi9ob21lL2psYS9naXQvcWphcnZpcy5jbGllbnQvc3JjL2pzL3NlcnZpY2VzL2F1dGhTZXJ2aWNlLmpzIiwiL2hvbWUvamxhL2dpdC9xamFydmlzLmNsaWVudC9zcmMvanMvc2VydmljZXMvY29uZmlnU2VydmljZS5qcyIsIi9ob21lL2psYS9naXQvcWphcnZpcy5jbGllbnQvc3JjL2pzL3NlcnZpY2VzL2Vycm9ySGFuZGxlclNlcnZpY2UuanMiLCIvaG9tZS9qbGEvZ2l0L3FqYXJ2aXMuY2xpZW50L3NyYy9qcy9zZXJ2aWNlcy9oZWxwZXJTZXJ2aWNlLmpzIiwiL2hvbWUvamxhL2dpdC9xamFydmlzLmNsaWVudC9zcmMvanMvc2VydmljZXMvbG9jYWxTZXNzaW9uU2VydmljZS5qcyIsIi9ob21lL2psYS9naXQvcWphcnZpcy5jbGllbnQvc3JjL2pzL3NlcnZpY2VzL2xvZ2dlclNlcnZpY2UuanMiLCIvaG9tZS9qbGEvZ2l0L3FqYXJ2aXMuY2xpZW50L3NyYy9qcy9zZXJ2aWNlcy9sb2dpblNlcnZpY2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZsQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0xBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwWkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1TUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcktBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNjQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDek9BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN01BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlRQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDWEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6S0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1SkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdklBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNmQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcGlDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6RkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDYkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpfXZhciBmPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChmLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGYsZi5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIoZnVuY3Rpb24gKHByb2Nlc3MsZ2xvYmFsLEJ1ZmZlcixfX2FyZ3VtZW50MCxfX2FyZ3VtZW50MSxfX2FyZ3VtZW50MixfX2FyZ3VtZW50MyxfX2ZpbGVuYW1lLF9fZGlybmFtZSl7XG4vKiFcbiAqIFRoZSBidWZmZXIgbW9kdWxlIGZyb20gbm9kZS5qcywgZm9yIHRoZSBicm93c2VyLlxuICpcbiAqIEBhdXRob3IgICBGZXJvc3MgQWJvdWtoYWRpamVoIDxmZXJvc3NAZmVyb3NzLm9yZz4gPGh0dHA6Ly9mZXJvc3Mub3JnPlxuICogQGxpY2Vuc2UgIE1JVFxuICovXG5cbnZhciBiYXNlNjQgPSByZXF1aXJlKCdiYXNlNjQtanMnKVxudmFyIGllZWU3NTQgPSByZXF1aXJlKCdpZWVlNzU0JylcblxuZXhwb3J0cy5CdWZmZXIgPSBCdWZmZXJcbmV4cG9ydHMuU2xvd0J1ZmZlciA9IEJ1ZmZlclxuZXhwb3J0cy5JTlNQRUNUX01BWF9CWVRFUyA9IDUwXG5CdWZmZXIucG9vbFNpemUgPSA4MTkyXG5cbi8qKlxuICogSWYgYEJ1ZmZlci5fdXNlVHlwZWRBcnJheXNgOlxuICogICA9PT0gdHJ1ZSAgICBVc2UgVWludDhBcnJheSBpbXBsZW1lbnRhdGlvbiAoZmFzdGVzdClcbiAqICAgPT09IGZhbHNlICAgVXNlIE9iamVjdCBpbXBsZW1lbnRhdGlvbiAoY29tcGF0aWJsZSBkb3duIHRvIElFNilcbiAqL1xuQnVmZmVyLl91c2VUeXBlZEFycmF5cyA9IChmdW5jdGlvbiAoKSB7XG4gIC8vIERldGVjdCBpZiBicm93c2VyIHN1cHBvcnRzIFR5cGVkIEFycmF5cy4gU3VwcG9ydGVkIGJyb3dzZXJzIGFyZSBJRSAxMCssIEZpcmVmb3ggNCssXG4gIC8vIENocm9tZSA3KywgU2FmYXJpIDUuMSssIE9wZXJhIDExLjYrLCBpT1MgNC4yKy4gSWYgdGhlIGJyb3dzZXIgZG9lcyBub3Qgc3VwcG9ydCBhZGRpbmdcbiAgLy8gcHJvcGVydGllcyB0byBgVWludDhBcnJheWAgaW5zdGFuY2VzLCB0aGVuIHRoYXQncyB0aGUgc2FtZSBhcyBubyBgVWludDhBcnJheWAgc3VwcG9ydFxuICAvLyBiZWNhdXNlIHdlIG5lZWQgdG8gYmUgYWJsZSB0byBhZGQgYWxsIHRoZSBub2RlIEJ1ZmZlciBBUEkgbWV0aG9kcy4gVGhpcyBpcyBhbiBpc3N1ZVxuICAvLyBpbiBGaXJlZm94IDQtMjkuIE5vdyBmaXhlZDogaHR0cHM6Ly9idWd6aWxsYS5tb3ppbGxhLm9yZy9zaG93X2J1Zy5jZ2k/aWQ9Njk1NDM4XG4gIHRyeSB7XG4gICAgdmFyIGJ1ZiA9IG5ldyBBcnJheUJ1ZmZlcigwKVxuICAgIHZhciBhcnIgPSBuZXcgVWludDhBcnJheShidWYpXG4gICAgYXJyLmZvbyA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuIDQyIH1cbiAgICByZXR1cm4gNDIgPT09IGFyci5mb28oKSAmJlxuICAgICAgICB0eXBlb2YgYXJyLnN1YmFycmF5ID09PSAnZnVuY3Rpb24nIC8vIENocm9tZSA5LTEwIGxhY2sgYHN1YmFycmF5YFxuICB9IGNhdGNoIChlKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbn0pKClcblxuLyoqXG4gKiBDbGFzczogQnVmZmVyXG4gKiA9PT09PT09PT09PT09XG4gKlxuICogVGhlIEJ1ZmZlciBjb25zdHJ1Y3RvciByZXR1cm5zIGluc3RhbmNlcyBvZiBgVWludDhBcnJheWAgdGhhdCBhcmUgYXVnbWVudGVkXG4gKiB3aXRoIGZ1bmN0aW9uIHByb3BlcnRpZXMgZm9yIGFsbCB0aGUgbm9kZSBgQnVmZmVyYCBBUEkgZnVuY3Rpb25zLiBXZSB1c2VcbiAqIGBVaW50OEFycmF5YCBzbyB0aGF0IHNxdWFyZSBicmFja2V0IG5vdGF0aW9uIHdvcmtzIGFzIGV4cGVjdGVkIC0tIGl0IHJldHVybnNcbiAqIGEgc2luZ2xlIG9jdGV0LlxuICpcbiAqIEJ5IGF1Z21lbnRpbmcgdGhlIGluc3RhbmNlcywgd2UgY2FuIGF2b2lkIG1vZGlmeWluZyB0aGUgYFVpbnQ4QXJyYXlgXG4gKiBwcm90b3R5cGUuXG4gKi9cbmZ1bmN0aW9uIEJ1ZmZlciAoc3ViamVjdCwgZW5jb2RpbmcsIG5vWmVybykge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgQnVmZmVyKSlcbiAgICByZXR1cm4gbmV3IEJ1ZmZlcihzdWJqZWN0LCBlbmNvZGluZywgbm9aZXJvKVxuXG4gIHZhciB0eXBlID0gdHlwZW9mIHN1YmplY3RcblxuICAvLyBXb3JrYXJvdW5kOiBub2RlJ3MgYmFzZTY0IGltcGxlbWVudGF0aW9uIGFsbG93cyBmb3Igbm9uLXBhZGRlZCBzdHJpbmdzXG4gIC8vIHdoaWxlIGJhc2U2NC1qcyBkb2VzIG5vdC5cbiAgaWYgKGVuY29kaW5nID09PSAnYmFzZTY0JyAmJiB0eXBlID09PSAnc3RyaW5nJykge1xuICAgIHN1YmplY3QgPSBzdHJpbmd0cmltKHN1YmplY3QpXG4gICAgd2hpbGUgKHN1YmplY3QubGVuZ3RoICUgNCAhPT0gMCkge1xuICAgICAgc3ViamVjdCA9IHN1YmplY3QgKyAnPSdcbiAgICB9XG4gIH1cblxuICAvLyBGaW5kIHRoZSBsZW5ndGhcbiAgdmFyIGxlbmd0aFxuICBpZiAodHlwZSA9PT0gJ251bWJlcicpXG4gICAgbGVuZ3RoID0gY29lcmNlKHN1YmplY3QpXG4gIGVsc2UgaWYgKHR5cGUgPT09ICdzdHJpbmcnKVxuICAgIGxlbmd0aCA9IEJ1ZmZlci5ieXRlTGVuZ3RoKHN1YmplY3QsIGVuY29kaW5nKVxuICBlbHNlIGlmICh0eXBlID09PSAnb2JqZWN0JylcbiAgICBsZW5ndGggPSBjb2VyY2Uoc3ViamVjdC5sZW5ndGgpIC8vIGFzc3VtZSB0aGF0IG9iamVjdCBpcyBhcnJheS1saWtlXG4gIGVsc2VcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZpcnN0IGFyZ3VtZW50IG5lZWRzIHRvIGJlIGEgbnVtYmVyLCBhcnJheSBvciBzdHJpbmcuJylcblxuICB2YXIgYnVmXG4gIGlmIChCdWZmZXIuX3VzZVR5cGVkQXJyYXlzKSB7XG4gICAgLy8gUHJlZmVycmVkOiBSZXR1cm4gYW4gYXVnbWVudGVkIGBVaW50OEFycmF5YCBpbnN0YW5jZSBmb3IgYmVzdCBwZXJmb3JtYW5jZVxuICAgIGJ1ZiA9IEJ1ZmZlci5fYXVnbWVudChuZXcgVWludDhBcnJheShsZW5ndGgpKVxuICB9IGVsc2Uge1xuICAgIC8vIEZhbGxiYWNrOiBSZXR1cm4gVEhJUyBpbnN0YW5jZSBvZiBCdWZmZXIgKGNyZWF0ZWQgYnkgYG5ld2ApXG4gICAgYnVmID0gdGhpc1xuICAgIGJ1Zi5sZW5ndGggPSBsZW5ndGhcbiAgICBidWYuX2lzQnVmZmVyID0gdHJ1ZVxuICB9XG5cbiAgdmFyIGlcbiAgaWYgKEJ1ZmZlci5fdXNlVHlwZWRBcnJheXMgJiYgdHlwZW9mIHN1YmplY3QuYnl0ZUxlbmd0aCA9PT0gJ251bWJlcicpIHtcbiAgICAvLyBTcGVlZCBvcHRpbWl6YXRpb24gLS0gdXNlIHNldCBpZiB3ZSdyZSBjb3B5aW5nIGZyb20gYSB0eXBlZCBhcnJheVxuICAgIGJ1Zi5fc2V0KHN1YmplY3QpXG4gIH0gZWxzZSBpZiAoaXNBcnJheWlzaChzdWJqZWN0KSkge1xuICAgIC8vIFRyZWF0IGFycmF5LWlzaCBvYmplY3RzIGFzIGEgYnl0ZSBhcnJheVxuICAgIGZvciAoaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgICAgaWYgKEJ1ZmZlci5pc0J1ZmZlcihzdWJqZWN0KSlcbiAgICAgICAgYnVmW2ldID0gc3ViamVjdC5yZWFkVUludDgoaSlcbiAgICAgIGVsc2VcbiAgICAgICAgYnVmW2ldID0gc3ViamVjdFtpXVxuICAgIH1cbiAgfSBlbHNlIGlmICh0eXBlID09PSAnc3RyaW5nJykge1xuICAgIGJ1Zi53cml0ZShzdWJqZWN0LCAwLCBlbmNvZGluZylcbiAgfSBlbHNlIGlmICh0eXBlID09PSAnbnVtYmVyJyAmJiAhQnVmZmVyLl91c2VUeXBlZEFycmF5cyAmJiAhbm9aZXJvKSB7XG4gICAgZm9yIChpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICBidWZbaV0gPSAwXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGJ1ZlxufVxuXG4vLyBTVEFUSUMgTUVUSE9EU1xuLy8gPT09PT09PT09PT09PT1cblxuQnVmZmVyLmlzRW5jb2RpbmcgPSBmdW5jdGlvbiAoZW5jb2RpbmcpIHtcbiAgc3dpdGNoIChTdHJpbmcoZW5jb2RpbmcpLnRvTG93ZXJDYXNlKCkpIHtcbiAgICBjYXNlICdoZXgnOlxuICAgIGNhc2UgJ3V0ZjgnOlxuICAgIGNhc2UgJ3V0Zi04JzpcbiAgICBjYXNlICdhc2NpaSc6XG4gICAgY2FzZSAnYmluYXJ5JzpcbiAgICBjYXNlICdiYXNlNjQnOlxuICAgIGNhc2UgJ3Jhdyc6XG4gICAgY2FzZSAndWNzMic6XG4gICAgY2FzZSAndWNzLTInOlxuICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgIHJldHVybiB0cnVlXG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBmYWxzZVxuICB9XG59XG5cbkJ1ZmZlci5pc0J1ZmZlciA9IGZ1bmN0aW9uIChiKSB7XG4gIHJldHVybiAhIShiICE9PSBudWxsICYmIGIgIT09IHVuZGVmaW5lZCAmJiBiLl9pc0J1ZmZlcilcbn1cblxuQnVmZmVyLmJ5dGVMZW5ndGggPSBmdW5jdGlvbiAoc3RyLCBlbmNvZGluZykge1xuICB2YXIgcmV0XG4gIHN0ciA9IHN0ciArICcnXG4gIHN3aXRjaCAoZW5jb2RpbmcgfHwgJ3V0ZjgnKSB7XG4gICAgY2FzZSAnaGV4JzpcbiAgICAgIHJldCA9IHN0ci5sZW5ndGggLyAyXG4gICAgICBicmVha1xuICAgIGNhc2UgJ3V0ZjgnOlxuICAgIGNhc2UgJ3V0Zi04JzpcbiAgICAgIHJldCA9IHV0ZjhUb0J5dGVzKHN0cikubGVuZ3RoXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2FzY2lpJzpcbiAgICBjYXNlICdiaW5hcnknOlxuICAgIGNhc2UgJ3Jhdyc6XG4gICAgICByZXQgPSBzdHIubGVuZ3RoXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICByZXQgPSBiYXNlNjRUb0J5dGVzKHN0cikubGVuZ3RoXG4gICAgICBicmVha1xuICAgIGNhc2UgJ3VjczInOlxuICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICBjYXNlICd1dGYxNmxlJzpcbiAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICByZXQgPSBzdHIubGVuZ3RoICogMlxuICAgICAgYnJlYWtcbiAgICBkZWZhdWx0OlxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdVbmtub3duIGVuY29kaW5nJylcbiAgfVxuICByZXR1cm4gcmV0XG59XG5cbkJ1ZmZlci5jb25jYXQgPSBmdW5jdGlvbiAobGlzdCwgdG90YWxMZW5ndGgpIHtcbiAgYXNzZXJ0KGlzQXJyYXkobGlzdCksICdVc2FnZTogQnVmZmVyLmNvbmNhdChsaXN0LCBbdG90YWxMZW5ndGhdKVxcbicgK1xuICAgICAgJ2xpc3Qgc2hvdWxkIGJlIGFuIEFycmF5LicpXG5cbiAgaWYgKGxpc3QubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIG5ldyBCdWZmZXIoMClcbiAgfSBlbHNlIGlmIChsaXN0Lmxlbmd0aCA9PT0gMSkge1xuICAgIHJldHVybiBsaXN0WzBdXG4gIH1cblxuICB2YXIgaVxuICBpZiAodHlwZW9mIHRvdGFsTGVuZ3RoICE9PSAnbnVtYmVyJykge1xuICAgIHRvdGFsTGVuZ3RoID0gMFxuICAgIGZvciAoaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgICB0b3RhbExlbmd0aCArPSBsaXN0W2ldLmxlbmd0aFxuICAgIH1cbiAgfVxuXG4gIHZhciBidWYgPSBuZXcgQnVmZmVyKHRvdGFsTGVuZ3RoKVxuICB2YXIgcG9zID0gMFxuICBmb3IgKGkgPSAwOyBpIDwgbGlzdC5sZW5ndGg7IGkrKykge1xuICAgIHZhciBpdGVtID0gbGlzdFtpXVxuICAgIGl0ZW0uY29weShidWYsIHBvcylcbiAgICBwb3MgKz0gaXRlbS5sZW5ndGhcbiAgfVxuICByZXR1cm4gYnVmXG59XG5cbi8vIEJVRkZFUiBJTlNUQU5DRSBNRVRIT0RTXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PVxuXG5mdW5jdGlvbiBfaGV4V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICBvZmZzZXQgPSBOdW1iZXIob2Zmc2V0KSB8fCAwXG4gIHZhciByZW1haW5pbmcgPSBidWYubGVuZ3RoIC0gb2Zmc2V0XG4gIGlmICghbGVuZ3RoKSB7XG4gICAgbGVuZ3RoID0gcmVtYWluaW5nXG4gIH0gZWxzZSB7XG4gICAgbGVuZ3RoID0gTnVtYmVyKGxlbmd0aClcbiAgICBpZiAobGVuZ3RoID4gcmVtYWluaW5nKSB7XG4gICAgICBsZW5ndGggPSByZW1haW5pbmdcbiAgICB9XG4gIH1cblxuICAvLyBtdXN0IGJlIGFuIGV2ZW4gbnVtYmVyIG9mIGRpZ2l0c1xuICB2YXIgc3RyTGVuID0gc3RyaW5nLmxlbmd0aFxuICBhc3NlcnQoc3RyTGVuICUgMiA9PT0gMCwgJ0ludmFsaWQgaGV4IHN0cmluZycpXG5cbiAgaWYgKGxlbmd0aCA+IHN0ckxlbiAvIDIpIHtcbiAgICBsZW5ndGggPSBzdHJMZW4gLyAyXG4gIH1cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIHZhciBieXRlID0gcGFyc2VJbnQoc3RyaW5nLnN1YnN0cihpICogMiwgMiksIDE2KVxuICAgIGFzc2VydCghaXNOYU4oYnl0ZSksICdJbnZhbGlkIGhleCBzdHJpbmcnKVxuICAgIGJ1ZltvZmZzZXQgKyBpXSA9IGJ5dGVcbiAgfVxuICBCdWZmZXIuX2NoYXJzV3JpdHRlbiA9IGkgKiAyXG4gIHJldHVybiBpXG59XG5cbmZ1bmN0aW9uIF91dGY4V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICB2YXIgY2hhcnNXcml0dGVuID0gQnVmZmVyLl9jaGFyc1dyaXR0ZW4gPVxuICAgIGJsaXRCdWZmZXIodXRmOFRvQnl0ZXMoc3RyaW5nKSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbiAgcmV0dXJuIGNoYXJzV3JpdHRlblxufVxuXG5mdW5jdGlvbiBfYXNjaWlXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHZhciBjaGFyc1dyaXR0ZW4gPSBCdWZmZXIuX2NoYXJzV3JpdHRlbiA9XG4gICAgYmxpdEJ1ZmZlcihhc2NpaVRvQnl0ZXMoc3RyaW5nKSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbiAgcmV0dXJuIGNoYXJzV3JpdHRlblxufVxuXG5mdW5jdGlvbiBfYmluYXJ5V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gX2FzY2lpV3JpdGUoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxufVxuXG5mdW5jdGlvbiBfYmFzZTY0V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICB2YXIgY2hhcnNXcml0dGVuID0gQnVmZmVyLl9jaGFyc1dyaXR0ZW4gPVxuICAgIGJsaXRCdWZmZXIoYmFzZTY0VG9CeXRlcyhzdHJpbmcpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxuICByZXR1cm4gY2hhcnNXcml0dGVuXG59XG5cbmZ1bmN0aW9uIF91dGYxNmxlV3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICB2YXIgY2hhcnNXcml0dGVuID0gQnVmZmVyLl9jaGFyc1dyaXR0ZW4gPVxuICAgIGJsaXRCdWZmZXIodXRmMTZsZVRvQnl0ZXMoc3RyaW5nKSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbiAgcmV0dXJuIGNoYXJzV3JpdHRlblxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlID0gZnVuY3Rpb24gKHN0cmluZywgb2Zmc2V0LCBsZW5ndGgsIGVuY29kaW5nKSB7XG4gIC8vIFN1cHBvcnQgYm90aCAoc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCwgZW5jb2RpbmcpXG4gIC8vIGFuZCB0aGUgbGVnYWN5IChzdHJpbmcsIGVuY29kaW5nLCBvZmZzZXQsIGxlbmd0aClcbiAgaWYgKGlzRmluaXRlKG9mZnNldCkpIHtcbiAgICBpZiAoIWlzRmluaXRlKGxlbmd0aCkpIHtcbiAgICAgIGVuY29kaW5nID0gbGVuZ3RoXG4gICAgICBsZW5ndGggPSB1bmRlZmluZWRcbiAgICB9XG4gIH0gZWxzZSB7ICAvLyBsZWdhY3lcbiAgICB2YXIgc3dhcCA9IGVuY29kaW5nXG4gICAgZW5jb2RpbmcgPSBvZmZzZXRcbiAgICBvZmZzZXQgPSBsZW5ndGhcbiAgICBsZW5ndGggPSBzd2FwXG4gIH1cblxuICBvZmZzZXQgPSBOdW1iZXIob2Zmc2V0KSB8fCAwXG4gIHZhciByZW1haW5pbmcgPSB0aGlzLmxlbmd0aCAtIG9mZnNldFxuICBpZiAoIWxlbmd0aCkge1xuICAgIGxlbmd0aCA9IHJlbWFpbmluZ1xuICB9IGVsc2Uge1xuICAgIGxlbmd0aCA9IE51bWJlcihsZW5ndGgpXG4gICAgaWYgKGxlbmd0aCA+IHJlbWFpbmluZykge1xuICAgICAgbGVuZ3RoID0gcmVtYWluaW5nXG4gICAgfVxuICB9XG4gIGVuY29kaW5nID0gU3RyaW5nKGVuY29kaW5nIHx8ICd1dGY4JykudG9Mb3dlckNhc2UoKVxuXG4gIHZhciByZXRcbiAgc3dpdGNoIChlbmNvZGluZykge1xuICAgIGNhc2UgJ2hleCc6XG4gICAgICByZXQgPSBfaGV4V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAndXRmOCc6XG4gICAgY2FzZSAndXRmLTgnOlxuICAgICAgcmV0ID0gX3V0ZjhXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICdhc2NpaSc6XG4gICAgICByZXQgPSBfYXNjaWlXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICdiaW5hcnknOlxuICAgICAgcmV0ID0gX2JpbmFyeVdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICByZXQgPSBfYmFzZTY0V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAndWNzMic6XG4gICAgY2FzZSAndWNzLTInOlxuICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgIHJldCA9IF91dGYxNmxlV3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbiAgICAgIGJyZWFrXG4gICAgZGVmYXVsdDpcbiAgICAgIHRocm93IG5ldyBFcnJvcignVW5rbm93biBlbmNvZGluZycpXG4gIH1cbiAgcmV0dXJuIHJldFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24gKGVuY29kaW5nLCBzdGFydCwgZW5kKSB7XG4gIHZhciBzZWxmID0gdGhpc1xuXG4gIGVuY29kaW5nID0gU3RyaW5nKGVuY29kaW5nIHx8ICd1dGY4JykudG9Mb3dlckNhc2UoKVxuICBzdGFydCA9IE51bWJlcihzdGFydCkgfHwgMFxuICBlbmQgPSAoZW5kICE9PSB1bmRlZmluZWQpXG4gICAgPyBOdW1iZXIoZW5kKVxuICAgIDogZW5kID0gc2VsZi5sZW5ndGhcblxuICAvLyBGYXN0cGF0aCBlbXB0eSBzdHJpbmdzXG4gIGlmIChlbmQgPT09IHN0YXJ0KVxuICAgIHJldHVybiAnJ1xuXG4gIHZhciByZXRcbiAgc3dpdGNoIChlbmNvZGluZykge1xuICAgIGNhc2UgJ2hleCc6XG4gICAgICByZXQgPSBfaGV4U2xpY2Uoc2VsZiwgc3RhcnQsIGVuZClcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAndXRmOCc6XG4gICAgY2FzZSAndXRmLTgnOlxuICAgICAgcmV0ID0gX3V0ZjhTbGljZShzZWxmLCBzdGFydCwgZW5kKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICdhc2NpaSc6XG4gICAgICByZXQgPSBfYXNjaWlTbGljZShzZWxmLCBzdGFydCwgZW5kKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICdiaW5hcnknOlxuICAgICAgcmV0ID0gX2JpbmFyeVNsaWNlKHNlbGYsIHN0YXJ0LCBlbmQpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICByZXQgPSBfYmFzZTY0U2xpY2Uoc2VsZiwgc3RhcnQsIGVuZClcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAndWNzMic6XG4gICAgY2FzZSAndWNzLTInOlxuICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgIHJldCA9IF91dGYxNmxlU2xpY2Uoc2VsZiwgc3RhcnQsIGVuZClcbiAgICAgIGJyZWFrXG4gICAgZGVmYXVsdDpcbiAgICAgIHRocm93IG5ldyBFcnJvcignVW5rbm93biBlbmNvZGluZycpXG4gIH1cbiAgcmV0dXJuIHJldFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnRvSlNPTiA9IGZ1bmN0aW9uICgpIHtcbiAgcmV0dXJuIHtcbiAgICB0eXBlOiAnQnVmZmVyJyxcbiAgICBkYXRhOiBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbCh0aGlzLl9hcnIgfHwgdGhpcywgMClcbiAgfVxufVxuXG4vLyBjb3B5KHRhcmdldEJ1ZmZlciwgdGFyZ2V0U3RhcnQ9MCwgc291cmNlU3RhcnQ9MCwgc291cmNlRW5kPWJ1ZmZlci5sZW5ndGgpXG5CdWZmZXIucHJvdG90eXBlLmNvcHkgPSBmdW5jdGlvbiAodGFyZ2V0LCB0YXJnZXRfc3RhcnQsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHNvdXJjZSA9IHRoaXNcblxuICBpZiAoIXN0YXJ0KSBzdGFydCA9IDBcbiAgaWYgKCFlbmQgJiYgZW5kICE9PSAwKSBlbmQgPSB0aGlzLmxlbmd0aFxuICBpZiAoIXRhcmdldF9zdGFydCkgdGFyZ2V0X3N0YXJ0ID0gMFxuXG4gIC8vIENvcHkgMCBieXRlczsgd2UncmUgZG9uZVxuICBpZiAoZW5kID09PSBzdGFydCkgcmV0dXJuXG4gIGlmICh0YXJnZXQubGVuZ3RoID09PSAwIHx8IHNvdXJjZS5sZW5ndGggPT09IDApIHJldHVyblxuXG4gIC8vIEZhdGFsIGVycm9yIGNvbmRpdGlvbnNcbiAgYXNzZXJ0KGVuZCA+PSBzdGFydCwgJ3NvdXJjZUVuZCA8IHNvdXJjZVN0YXJ0JylcbiAgYXNzZXJ0KHRhcmdldF9zdGFydCA+PSAwICYmIHRhcmdldF9zdGFydCA8IHRhcmdldC5sZW5ndGgsXG4gICAgICAndGFyZ2V0U3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIGFzc2VydChzdGFydCA+PSAwICYmIHN0YXJ0IDwgc291cmNlLmxlbmd0aCwgJ3NvdXJjZVN0YXJ0IG91dCBvZiBib3VuZHMnKVxuICBhc3NlcnQoZW5kID49IDAgJiYgZW5kIDw9IHNvdXJjZS5sZW5ndGgsICdzb3VyY2VFbmQgb3V0IG9mIGJvdW5kcycpXG5cbiAgLy8gQXJlIHdlIG9vYj9cbiAgaWYgKGVuZCA+IHRoaXMubGVuZ3RoKVxuICAgIGVuZCA9IHRoaXMubGVuZ3RoXG4gIGlmICh0YXJnZXQubGVuZ3RoIC0gdGFyZ2V0X3N0YXJ0IDwgZW5kIC0gc3RhcnQpXG4gICAgZW5kID0gdGFyZ2V0Lmxlbmd0aCAtIHRhcmdldF9zdGFydCArIHN0YXJ0XG5cbiAgdmFyIGxlbiA9IGVuZCAtIHN0YXJ0XG5cbiAgaWYgKGxlbiA8IDEwMCB8fCAhQnVmZmVyLl91c2VUeXBlZEFycmF5cykge1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyBpKyspXG4gICAgICB0YXJnZXRbaSArIHRhcmdldF9zdGFydF0gPSB0aGlzW2kgKyBzdGFydF1cbiAgfSBlbHNlIHtcbiAgICB0YXJnZXQuX3NldCh0aGlzLnN1YmFycmF5KHN0YXJ0LCBzdGFydCArIGxlbiksIHRhcmdldF9zdGFydClcbiAgfVxufVxuXG5mdW5jdGlvbiBfYmFzZTY0U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICBpZiAoc3RhcnQgPT09IDAgJiYgZW5kID09PSBidWYubGVuZ3RoKSB7XG4gICAgcmV0dXJuIGJhc2U2NC5mcm9tQnl0ZUFycmF5KGJ1ZilcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gYmFzZTY0LmZyb21CeXRlQXJyYXkoYnVmLnNsaWNlKHN0YXJ0LCBlbmQpKVxuICB9XG59XG5cbmZ1bmN0aW9uIF91dGY4U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgcmVzID0gJydcbiAgdmFyIHRtcCA9ICcnXG4gIGVuZCA9IE1hdGgubWluKGJ1Zi5sZW5ndGgsIGVuZClcblxuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgIGlmIChidWZbaV0gPD0gMHg3Rikge1xuICAgICAgcmVzICs9IGRlY29kZVV0ZjhDaGFyKHRtcCkgKyBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ1ZltpXSlcbiAgICAgIHRtcCA9ICcnXG4gICAgfSBlbHNlIHtcbiAgICAgIHRtcCArPSAnJScgKyBidWZbaV0udG9TdHJpbmcoMTYpXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHJlcyArIGRlY29kZVV0ZjhDaGFyKHRtcClcbn1cblxuZnVuY3Rpb24gX2FzY2lpU2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgcmV0ID0gJydcbiAgZW5kID0gTWF0aC5taW4oYnVmLmxlbmd0aCwgZW5kKVxuXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKVxuICAgIHJldCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ1ZltpXSlcbiAgcmV0dXJuIHJldFxufVxuXG5mdW5jdGlvbiBfYmluYXJ5U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICByZXR1cm4gX2FzY2lpU2xpY2UoYnVmLCBzdGFydCwgZW5kKVxufVxuXG5mdW5jdGlvbiBfaGV4U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgbGVuID0gYnVmLmxlbmd0aFxuXG4gIGlmICghc3RhcnQgfHwgc3RhcnQgPCAwKSBzdGFydCA9IDBcbiAgaWYgKCFlbmQgfHwgZW5kIDwgMCB8fCBlbmQgPiBsZW4pIGVuZCA9IGxlblxuXG4gIHZhciBvdXQgPSAnJ1xuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgIG91dCArPSB0b0hleChidWZbaV0pXG4gIH1cbiAgcmV0dXJuIG91dFxufVxuXG5mdW5jdGlvbiBfdXRmMTZsZVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGJ5dGVzID0gYnVmLnNsaWNlKHN0YXJ0LCBlbmQpXG4gIHZhciByZXMgPSAnJ1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGJ5dGVzLmxlbmd0aDsgaSArPSAyKSB7XG4gICAgcmVzICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnl0ZXNbaV0gKyBieXRlc1tpKzFdICogMjU2KVxuICB9XG4gIHJldHVybiByZXNcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5zbGljZSA9IGZ1bmN0aW9uIChzdGFydCwgZW5kKSB7XG4gIHZhciBsZW4gPSB0aGlzLmxlbmd0aFxuICBzdGFydCA9IGNsYW1wKHN0YXJ0LCBsZW4sIDApXG4gIGVuZCA9IGNsYW1wKGVuZCwgbGVuLCBsZW4pXG5cbiAgaWYgKEJ1ZmZlci5fdXNlVHlwZWRBcnJheXMpIHtcbiAgICByZXR1cm4gQnVmZmVyLl9hdWdtZW50KHRoaXMuc3ViYXJyYXkoc3RhcnQsIGVuZCkpXG4gIH0gZWxzZSB7XG4gICAgdmFyIHNsaWNlTGVuID0gZW5kIC0gc3RhcnRcbiAgICB2YXIgbmV3QnVmID0gbmV3IEJ1ZmZlcihzbGljZUxlbiwgdW5kZWZpbmVkLCB0cnVlKVxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc2xpY2VMZW47IGkrKykge1xuICAgICAgbmV3QnVmW2ldID0gdGhpc1tpICsgc3RhcnRdXG4gICAgfVxuICAgIHJldHVybiBuZXdCdWZcbiAgfVxufVxuXG4vLyBgZ2V0YCB3aWxsIGJlIHJlbW92ZWQgaW4gTm9kZSAwLjEzK1xuQnVmZmVyLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbiAob2Zmc2V0KSB7XG4gIGNvbnNvbGUubG9nKCcuZ2V0KCkgaXMgZGVwcmVjYXRlZC4gQWNjZXNzIHVzaW5nIGFycmF5IGluZGV4ZXMgaW5zdGVhZC4nKVxuICByZXR1cm4gdGhpcy5yZWFkVUludDgob2Zmc2V0KVxufVxuXG4vLyBgc2V0YCB3aWxsIGJlIHJlbW92ZWQgaW4gTm9kZSAwLjEzK1xuQnVmZmVyLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbiAodiwgb2Zmc2V0KSB7XG4gIGNvbnNvbGUubG9nKCcuc2V0KCkgaXMgZGVwcmVjYXRlZC4gQWNjZXNzIHVzaW5nIGFycmF5IGluZGV4ZXMgaW5zdGVhZC4nKVxuICByZXR1cm4gdGhpcy53cml0ZVVJbnQ4KHYsIG9mZnNldClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDggPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0KG9mZnNldCAhPT0gdW5kZWZpbmVkICYmIG9mZnNldCAhPT0gbnVsbCwgJ21pc3Npbmcgb2Zmc2V0JylcbiAgICBhc3NlcnQob2Zmc2V0IDwgdGhpcy5sZW5ndGgsICdUcnlpbmcgdG8gcmVhZCBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG4gIH1cblxuICBpZiAob2Zmc2V0ID49IHRoaXMubGVuZ3RoKVxuICAgIHJldHVyblxuXG4gIHJldHVybiB0aGlzW29mZnNldF1cbn1cblxuZnVuY3Rpb24gX3JlYWRVSW50MTYgKGJ1Ziwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBhc3NlcnQodHlwZW9mIGxpdHRsZUVuZGlhbiA9PT0gJ2Jvb2xlYW4nLCAnbWlzc2luZyBvciBpbnZhbGlkIGVuZGlhbicpXG4gICAgYXNzZXJ0KG9mZnNldCAhPT0gdW5kZWZpbmVkICYmIG9mZnNldCAhPT0gbnVsbCwgJ21pc3Npbmcgb2Zmc2V0JylcbiAgICBhc3NlcnQob2Zmc2V0ICsgMSA8IGJ1Zi5sZW5ndGgsICdUcnlpbmcgdG8gcmVhZCBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG4gIH1cblxuICB2YXIgbGVuID0gYnVmLmxlbmd0aFxuICBpZiAob2Zmc2V0ID49IGxlbilcbiAgICByZXR1cm5cblxuICB2YXIgdmFsXG4gIGlmIChsaXR0bGVFbmRpYW4pIHtcbiAgICB2YWwgPSBidWZbb2Zmc2V0XVxuICAgIGlmIChvZmZzZXQgKyAxIDwgbGVuKVxuICAgICAgdmFsIHw9IGJ1ZltvZmZzZXQgKyAxXSA8PCA4XG4gIH0gZWxzZSB7XG4gICAgdmFsID0gYnVmW29mZnNldF0gPDwgOFxuICAgIGlmIChvZmZzZXQgKyAxIDwgbGVuKVxuICAgICAgdmFsIHw9IGJ1ZltvZmZzZXQgKyAxXVxuICB9XG4gIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDE2TEUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gX3JlYWRVSW50MTYodGhpcywgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDE2QkUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gX3JlYWRVSW50MTYodGhpcywgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbmZ1bmN0aW9uIF9yZWFkVUludDMyIChidWYsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0KHR5cGVvZiBsaXR0bGVFbmRpYW4gPT09ICdib29sZWFuJywgJ21pc3Npbmcgb3IgaW52YWxpZCBlbmRpYW4nKVxuICAgIGFzc2VydChvZmZzZXQgIT09IHVuZGVmaW5lZCAmJiBvZmZzZXQgIT09IG51bGwsICdtaXNzaW5nIG9mZnNldCcpXG4gICAgYXNzZXJ0KG9mZnNldCArIDMgPCBidWYubGVuZ3RoLCAnVHJ5aW5nIHRvIHJlYWQgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKVxuICB9XG5cbiAgdmFyIGxlbiA9IGJ1Zi5sZW5ndGhcbiAgaWYgKG9mZnNldCA+PSBsZW4pXG4gICAgcmV0dXJuXG5cbiAgdmFyIHZhbFxuICBpZiAobGl0dGxlRW5kaWFuKSB7XG4gICAgaWYgKG9mZnNldCArIDIgPCBsZW4pXG4gICAgICB2YWwgPSBidWZbb2Zmc2V0ICsgMl0gPDwgMTZcbiAgICBpZiAob2Zmc2V0ICsgMSA8IGxlbilcbiAgICAgIHZhbCB8PSBidWZbb2Zmc2V0ICsgMV0gPDwgOFxuICAgIHZhbCB8PSBidWZbb2Zmc2V0XVxuICAgIGlmIChvZmZzZXQgKyAzIDwgbGVuKVxuICAgICAgdmFsID0gdmFsICsgKGJ1ZltvZmZzZXQgKyAzXSA8PCAyNCA+Pj4gMClcbiAgfSBlbHNlIHtcbiAgICBpZiAob2Zmc2V0ICsgMSA8IGxlbilcbiAgICAgIHZhbCA9IGJ1ZltvZmZzZXQgKyAxXSA8PCAxNlxuICAgIGlmIChvZmZzZXQgKyAyIDwgbGVuKVxuICAgICAgdmFsIHw9IGJ1ZltvZmZzZXQgKyAyXSA8PCA4XG4gICAgaWYgKG9mZnNldCArIDMgPCBsZW4pXG4gICAgICB2YWwgfD0gYnVmW29mZnNldCArIDNdXG4gICAgdmFsID0gdmFsICsgKGJ1ZltvZmZzZXRdIDw8IDI0ID4+PiAwKVxuICB9XG4gIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDMyTEUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gX3JlYWRVSW50MzIodGhpcywgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDMyQkUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gX3JlYWRVSW50MzIodGhpcywgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDggPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0KG9mZnNldCAhPT0gdW5kZWZpbmVkICYmIG9mZnNldCAhPT0gbnVsbCxcbiAgICAgICAgJ21pc3Npbmcgb2Zmc2V0JylcbiAgICBhc3NlcnQob2Zmc2V0IDwgdGhpcy5sZW5ndGgsICdUcnlpbmcgdG8gcmVhZCBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG4gIH1cblxuICBpZiAob2Zmc2V0ID49IHRoaXMubGVuZ3RoKVxuICAgIHJldHVyblxuXG4gIHZhciBuZWcgPSB0aGlzW29mZnNldF0gJiAweDgwXG4gIGlmIChuZWcpXG4gICAgcmV0dXJuICgweGZmIC0gdGhpc1tvZmZzZXRdICsgMSkgKiAtMVxuICBlbHNlXG4gICAgcmV0dXJuIHRoaXNbb2Zmc2V0XVxufVxuXG5mdW5jdGlvbiBfcmVhZEludDE2IChidWYsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0KHR5cGVvZiBsaXR0bGVFbmRpYW4gPT09ICdib29sZWFuJywgJ21pc3Npbmcgb3IgaW52YWxpZCBlbmRpYW4nKVxuICAgIGFzc2VydChvZmZzZXQgIT09IHVuZGVmaW5lZCAmJiBvZmZzZXQgIT09IG51bGwsICdtaXNzaW5nIG9mZnNldCcpXG4gICAgYXNzZXJ0KG9mZnNldCArIDEgPCBidWYubGVuZ3RoLCAnVHJ5aW5nIHRvIHJlYWQgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKVxuICB9XG5cbiAgdmFyIGxlbiA9IGJ1Zi5sZW5ndGhcbiAgaWYgKG9mZnNldCA+PSBsZW4pXG4gICAgcmV0dXJuXG5cbiAgdmFyIHZhbCA9IF9yZWFkVUludDE2KGJ1Ziwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIHRydWUpXG4gIHZhciBuZWcgPSB2YWwgJiAweDgwMDBcbiAgaWYgKG5lZylcbiAgICByZXR1cm4gKDB4ZmZmZiAtIHZhbCArIDEpICogLTFcbiAgZWxzZVxuICAgIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MTZMRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiBfcmVhZEludDE2KHRoaXMsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDE2QkUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gX3JlYWRJbnQxNih0aGlzLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuZnVuY3Rpb24gX3JlYWRJbnQzMiAoYnVmLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydCh0eXBlb2YgbGl0dGxlRW5kaWFuID09PSAnYm9vbGVhbicsICdtaXNzaW5nIG9yIGludmFsaWQgZW5kaWFuJylcbiAgICBhc3NlcnQob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLCAnbWlzc2luZyBvZmZzZXQnKVxuICAgIGFzc2VydChvZmZzZXQgKyAzIDwgYnVmLmxlbmd0aCwgJ1RyeWluZyB0byByZWFkIGJleW9uZCBidWZmZXIgbGVuZ3RoJylcbiAgfVxuXG4gIHZhciBsZW4gPSBidWYubGVuZ3RoXG4gIGlmIChvZmZzZXQgPj0gbGVuKVxuICAgIHJldHVyblxuXG4gIHZhciB2YWwgPSBfcmVhZFVJbnQzMihidWYsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCB0cnVlKVxuICB2YXIgbmVnID0gdmFsICYgMHg4MDAwMDAwMFxuICBpZiAobmVnKVxuICAgIHJldHVybiAoMHhmZmZmZmZmZiAtIHZhbCArIDEpICogLTFcbiAgZWxzZVxuICAgIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MzJMRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiBfcmVhZEludDMyKHRoaXMsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDMyQkUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gX3JlYWRJbnQzMih0aGlzLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuZnVuY3Rpb24gX3JlYWRGbG9hdCAoYnVmLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydCh0eXBlb2YgbGl0dGxlRW5kaWFuID09PSAnYm9vbGVhbicsICdtaXNzaW5nIG9yIGludmFsaWQgZW5kaWFuJylcbiAgICBhc3NlcnQob2Zmc2V0ICsgMyA8IGJ1Zi5sZW5ndGgsICdUcnlpbmcgdG8gcmVhZCBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG4gIH1cblxuICByZXR1cm4gaWVlZTc1NC5yZWFkKGJ1Ziwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIDIzLCA0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRGbG9hdExFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIF9yZWFkRmxvYXQodGhpcywgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRmxvYXRCRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiBfcmVhZEZsb2F0KHRoaXMsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KVxufVxuXG5mdW5jdGlvbiBfcmVhZERvdWJsZSAoYnVmLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydCh0eXBlb2YgbGl0dGxlRW5kaWFuID09PSAnYm9vbGVhbicsICdtaXNzaW5nIG9yIGludmFsaWQgZW5kaWFuJylcbiAgICBhc3NlcnQob2Zmc2V0ICsgNyA8IGJ1Zi5sZW5ndGgsICdUcnlpbmcgdG8gcmVhZCBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG4gIH1cblxuICByZXR1cm4gaWVlZTc1NC5yZWFkKGJ1Ziwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIDUyLCA4KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWREb3VibGVMRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiBfcmVhZERvdWJsZSh0aGlzLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWREb3VibGVCRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiBfcmVhZERvdWJsZSh0aGlzLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQ4ID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBhc3NlcnQodmFsdWUgIT09IHVuZGVmaW5lZCAmJiB2YWx1ZSAhPT0gbnVsbCwgJ21pc3NpbmcgdmFsdWUnKVxuICAgIGFzc2VydChvZmZzZXQgIT09IHVuZGVmaW5lZCAmJiBvZmZzZXQgIT09IG51bGwsICdtaXNzaW5nIG9mZnNldCcpXG4gICAgYXNzZXJ0KG9mZnNldCA8IHRoaXMubGVuZ3RoLCAndHJ5aW5nIHRvIHdyaXRlIGJleW9uZCBidWZmZXIgbGVuZ3RoJylcbiAgICB2ZXJpZnVpbnQodmFsdWUsIDB4ZmYpXG4gIH1cblxuICBpZiAob2Zmc2V0ID49IHRoaXMubGVuZ3RoKSByZXR1cm5cblxuICB0aGlzW29mZnNldF0gPSB2YWx1ZVxufVxuXG5mdW5jdGlvbiBfd3JpdGVVSW50MTYgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0KHZhbHVlICE9PSB1bmRlZmluZWQgJiYgdmFsdWUgIT09IG51bGwsICdtaXNzaW5nIHZhbHVlJylcbiAgICBhc3NlcnQodHlwZW9mIGxpdHRsZUVuZGlhbiA9PT0gJ2Jvb2xlYW4nLCAnbWlzc2luZyBvciBpbnZhbGlkIGVuZGlhbicpXG4gICAgYXNzZXJ0KG9mZnNldCAhPT0gdW5kZWZpbmVkICYmIG9mZnNldCAhPT0gbnVsbCwgJ21pc3Npbmcgb2Zmc2V0JylcbiAgICBhc3NlcnQob2Zmc2V0ICsgMSA8IGJ1Zi5sZW5ndGgsICd0cnlpbmcgdG8gd3JpdGUgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKVxuICAgIHZlcmlmdWludCh2YWx1ZSwgMHhmZmZmKVxuICB9XG5cbiAgdmFyIGxlbiA9IGJ1Zi5sZW5ndGhcbiAgaWYgKG9mZnNldCA+PSBsZW4pXG4gICAgcmV0dXJuXG5cbiAgZm9yICh2YXIgaSA9IDAsIGogPSBNYXRoLm1pbihsZW4gLSBvZmZzZXQsIDIpOyBpIDwgajsgaSsrKSB7XG4gICAgYnVmW29mZnNldCArIGldID1cbiAgICAgICAgKHZhbHVlICYgKDB4ZmYgPDwgKDggKiAobGl0dGxlRW5kaWFuID8gaSA6IDEgLSBpKSkpKSA+Pj5cbiAgICAgICAgICAgIChsaXR0bGVFbmRpYW4gPyBpIDogMSAtIGkpICogOFxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MTZMRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICBfd3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MTZCRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICBfd3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KVxufVxuXG5mdW5jdGlvbiBfd3JpdGVVSW50MzIgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0KHZhbHVlICE9PSB1bmRlZmluZWQgJiYgdmFsdWUgIT09IG51bGwsICdtaXNzaW5nIHZhbHVlJylcbiAgICBhc3NlcnQodHlwZW9mIGxpdHRsZUVuZGlhbiA9PT0gJ2Jvb2xlYW4nLCAnbWlzc2luZyBvciBpbnZhbGlkIGVuZGlhbicpXG4gICAgYXNzZXJ0KG9mZnNldCAhPT0gdW5kZWZpbmVkICYmIG9mZnNldCAhPT0gbnVsbCwgJ21pc3Npbmcgb2Zmc2V0JylcbiAgICBhc3NlcnQob2Zmc2V0ICsgMyA8IGJ1Zi5sZW5ndGgsICd0cnlpbmcgdG8gd3JpdGUgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKVxuICAgIHZlcmlmdWludCh2YWx1ZSwgMHhmZmZmZmZmZilcbiAgfVxuXG4gIHZhciBsZW4gPSBidWYubGVuZ3RoXG4gIGlmIChvZmZzZXQgPj0gbGVuKVxuICAgIHJldHVyblxuXG4gIGZvciAodmFyIGkgPSAwLCBqID0gTWF0aC5taW4obGVuIC0gb2Zmc2V0LCA0KTsgaSA8IGo7IGkrKykge1xuICAgIGJ1ZltvZmZzZXQgKyBpXSA9XG4gICAgICAgICh2YWx1ZSA+Pj4gKGxpdHRsZUVuZGlhbiA/IGkgOiAzIC0gaSkgKiA4KSAmIDB4ZmZcbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDMyTEUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgX3dyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDMyQkUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgX3dyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDggPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydCh2YWx1ZSAhPT0gdW5kZWZpbmVkICYmIHZhbHVlICE9PSBudWxsLCAnbWlzc2luZyB2YWx1ZScpXG4gICAgYXNzZXJ0KG9mZnNldCAhPT0gdW5kZWZpbmVkICYmIG9mZnNldCAhPT0gbnVsbCwgJ21pc3Npbmcgb2Zmc2V0JylcbiAgICBhc3NlcnQob2Zmc2V0IDwgdGhpcy5sZW5ndGgsICdUcnlpbmcgdG8gd3JpdGUgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKVxuICAgIHZlcmlmc2ludCh2YWx1ZSwgMHg3ZiwgLTB4ODApXG4gIH1cblxuICBpZiAob2Zmc2V0ID49IHRoaXMubGVuZ3RoKVxuICAgIHJldHVyblxuXG4gIGlmICh2YWx1ZSA+PSAwKVxuICAgIHRoaXMud3JpdGVVSW50OCh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydClcbiAgZWxzZVxuICAgIHRoaXMud3JpdGVVSW50OCgweGZmICsgdmFsdWUgKyAxLCBvZmZzZXQsIG5vQXNzZXJ0KVxufVxuXG5mdW5jdGlvbiBfd3JpdGVJbnQxNiAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBhc3NlcnQodmFsdWUgIT09IHVuZGVmaW5lZCAmJiB2YWx1ZSAhPT0gbnVsbCwgJ21pc3NpbmcgdmFsdWUnKVxuICAgIGFzc2VydCh0eXBlb2YgbGl0dGxlRW5kaWFuID09PSAnYm9vbGVhbicsICdtaXNzaW5nIG9yIGludmFsaWQgZW5kaWFuJylcbiAgICBhc3NlcnQob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLCAnbWlzc2luZyBvZmZzZXQnKVxuICAgIGFzc2VydChvZmZzZXQgKyAxIDwgYnVmLmxlbmd0aCwgJ1RyeWluZyB0byB3cml0ZSBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG4gICAgdmVyaWZzaW50KHZhbHVlLCAweDdmZmYsIC0weDgwMDApXG4gIH1cblxuICB2YXIgbGVuID0gYnVmLmxlbmd0aFxuICBpZiAob2Zmc2V0ID49IGxlbilcbiAgICByZXR1cm5cblxuICBpZiAodmFsdWUgPj0gMClcbiAgICBfd3JpdGVVSW50MTYoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KVxuICBlbHNlXG4gICAgX3dyaXRlVUludDE2KGJ1ZiwgMHhmZmZmICsgdmFsdWUgKyAxLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQxNkxFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIF93cml0ZUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MTZCRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICBfd3JpdGVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbmZ1bmN0aW9uIF93cml0ZUludDMyIChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydCh2YWx1ZSAhPT0gdW5kZWZpbmVkICYmIHZhbHVlICE9PSBudWxsLCAnbWlzc2luZyB2YWx1ZScpXG4gICAgYXNzZXJ0KHR5cGVvZiBsaXR0bGVFbmRpYW4gPT09ICdib29sZWFuJywgJ21pc3Npbmcgb3IgaW52YWxpZCBlbmRpYW4nKVxuICAgIGFzc2VydChvZmZzZXQgIT09IHVuZGVmaW5lZCAmJiBvZmZzZXQgIT09IG51bGwsICdtaXNzaW5nIG9mZnNldCcpXG4gICAgYXNzZXJ0KG9mZnNldCArIDMgPCBidWYubGVuZ3RoLCAnVHJ5aW5nIHRvIHdyaXRlIGJleW9uZCBidWZmZXIgbGVuZ3RoJylcbiAgICB2ZXJpZnNpbnQodmFsdWUsIDB4N2ZmZmZmZmYsIC0weDgwMDAwMDAwKVxuICB9XG5cbiAgdmFyIGxlbiA9IGJ1Zi5sZW5ndGhcbiAgaWYgKG9mZnNldCA+PSBsZW4pXG4gICAgcmV0dXJuXG5cbiAgaWYgKHZhbHVlID49IDApXG4gICAgX3dyaXRlVUludDMyKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydClcbiAgZWxzZVxuICAgIF93cml0ZVVJbnQzMihidWYsIDB4ZmZmZmZmZmYgKyB2YWx1ZSArIDEsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDMyTEUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgX3dyaXRlSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQzMkJFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIF93cml0ZUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuZnVuY3Rpb24gX3dyaXRlRmxvYXQgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0KHZhbHVlICE9PSB1bmRlZmluZWQgJiYgdmFsdWUgIT09IG51bGwsICdtaXNzaW5nIHZhbHVlJylcbiAgICBhc3NlcnQodHlwZW9mIGxpdHRsZUVuZGlhbiA9PT0gJ2Jvb2xlYW4nLCAnbWlzc2luZyBvciBpbnZhbGlkIGVuZGlhbicpXG4gICAgYXNzZXJ0KG9mZnNldCAhPT0gdW5kZWZpbmVkICYmIG9mZnNldCAhPT0gbnVsbCwgJ21pc3Npbmcgb2Zmc2V0JylcbiAgICBhc3NlcnQob2Zmc2V0ICsgMyA8IGJ1Zi5sZW5ndGgsICdUcnlpbmcgdG8gd3JpdGUgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKVxuICAgIHZlcmlmSUVFRTc1NCh2YWx1ZSwgMy40MDI4MjM0NjYzODUyODg2ZSszOCwgLTMuNDAyODIzNDY2Mzg1Mjg4NmUrMzgpXG4gIH1cblxuICB2YXIgbGVuID0gYnVmLmxlbmd0aFxuICBpZiAob2Zmc2V0ID49IGxlbilcbiAgICByZXR1cm5cblxuICBpZWVlNzU0LndyaXRlKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCAyMywgNClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUZsb2F0TEUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgX3dyaXRlRmxvYXQodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVGbG9hdEJFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIF93cml0ZUZsb2F0KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuZnVuY3Rpb24gX3dyaXRlRG91YmxlIChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydCh2YWx1ZSAhPT0gdW5kZWZpbmVkICYmIHZhbHVlICE9PSBudWxsLCAnbWlzc2luZyB2YWx1ZScpXG4gICAgYXNzZXJ0KHR5cGVvZiBsaXR0bGVFbmRpYW4gPT09ICdib29sZWFuJywgJ21pc3Npbmcgb3IgaW52YWxpZCBlbmRpYW4nKVxuICAgIGFzc2VydChvZmZzZXQgIT09IHVuZGVmaW5lZCAmJiBvZmZzZXQgIT09IG51bGwsICdtaXNzaW5nIG9mZnNldCcpXG4gICAgYXNzZXJ0KG9mZnNldCArIDcgPCBidWYubGVuZ3RoLFxuICAgICAgICAnVHJ5aW5nIHRvIHdyaXRlIGJleW9uZCBidWZmZXIgbGVuZ3RoJylcbiAgICB2ZXJpZklFRUU3NTQodmFsdWUsIDEuNzk3NjkzMTM0ODYyMzE1N0UrMzA4LCAtMS43OTc2OTMxMzQ4NjIzMTU3RSszMDgpXG4gIH1cblxuICB2YXIgbGVuID0gYnVmLmxlbmd0aFxuICBpZiAob2Zmc2V0ID49IGxlbilcbiAgICByZXR1cm5cblxuICBpZWVlNzU0LndyaXRlKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCA1MiwgOClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZURvdWJsZUxFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIF93cml0ZURvdWJsZSh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZURvdWJsZUJFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIF93cml0ZURvdWJsZSh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbi8vIGZpbGwodmFsdWUsIHN0YXJ0PTAsIGVuZD1idWZmZXIubGVuZ3RoKVxuQnVmZmVyLnByb3RvdHlwZS5maWxsID0gZnVuY3Rpb24gKHZhbHVlLCBzdGFydCwgZW5kKSB7XG4gIGlmICghdmFsdWUpIHZhbHVlID0gMFxuICBpZiAoIXN0YXJ0KSBzdGFydCA9IDBcbiAgaWYgKCFlbmQpIGVuZCA9IHRoaXMubGVuZ3RoXG5cbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICB2YWx1ZSA9IHZhbHVlLmNoYXJDb2RlQXQoMClcbiAgfVxuXG4gIGFzc2VydCh0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInICYmICFpc05hTih2YWx1ZSksICd2YWx1ZSBpcyBub3QgYSBudW1iZXInKVxuICBhc3NlcnQoZW5kID49IHN0YXJ0LCAnZW5kIDwgc3RhcnQnKVxuXG4gIC8vIEZpbGwgMCBieXRlczsgd2UncmUgZG9uZVxuICBpZiAoZW5kID09PSBzdGFydCkgcmV0dXJuXG4gIGlmICh0aGlzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgYXNzZXJ0KHN0YXJ0ID49IDAgJiYgc3RhcnQgPCB0aGlzLmxlbmd0aCwgJ3N0YXJ0IG91dCBvZiBib3VuZHMnKVxuICBhc3NlcnQoZW5kID49IDAgJiYgZW5kIDw9IHRoaXMubGVuZ3RoLCAnZW5kIG91dCBvZiBib3VuZHMnKVxuXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgdGhpc1tpXSA9IHZhbHVlXG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS5pbnNwZWN0ID0gZnVuY3Rpb24gKCkge1xuICB2YXIgb3V0ID0gW11cbiAgdmFyIGxlbiA9IHRoaXMubGVuZ3RoXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyBpKyspIHtcbiAgICBvdXRbaV0gPSB0b0hleCh0aGlzW2ldKVxuICAgIGlmIChpID09PSBleHBvcnRzLklOU1BFQ1RfTUFYX0JZVEVTKSB7XG4gICAgICBvdXRbaSArIDFdID0gJy4uLidcbiAgICAgIGJyZWFrXG4gICAgfVxuICB9XG4gIHJldHVybiAnPEJ1ZmZlciAnICsgb3V0LmpvaW4oJyAnKSArICc+J1xufVxuXG4vKipcbiAqIENyZWF0ZXMgYSBuZXcgYEFycmF5QnVmZmVyYCB3aXRoIHRoZSAqY29waWVkKiBtZW1vcnkgb2YgdGhlIGJ1ZmZlciBpbnN0YW5jZS5cbiAqIEFkZGVkIGluIE5vZGUgMC4xMi4gT25seSBhdmFpbGFibGUgaW4gYnJvd3NlcnMgdGhhdCBzdXBwb3J0IEFycmF5QnVmZmVyLlxuICovXG5CdWZmZXIucHJvdG90eXBlLnRvQXJyYXlCdWZmZXIgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICh0eXBlb2YgVWludDhBcnJheSAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBpZiAoQnVmZmVyLl91c2VUeXBlZEFycmF5cykge1xuICAgICAgcmV0dXJuIChuZXcgQnVmZmVyKHRoaXMpKS5idWZmZXJcbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIGJ1ZiA9IG5ldyBVaW50OEFycmF5KHRoaXMubGVuZ3RoKVxuICAgICAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IGJ1Zi5sZW5ndGg7IGkgPCBsZW47IGkgKz0gMSlcbiAgICAgICAgYnVmW2ldID0gdGhpc1tpXVxuICAgICAgcmV0dXJuIGJ1Zi5idWZmZXJcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdCdWZmZXIudG9BcnJheUJ1ZmZlciBub3Qgc3VwcG9ydGVkIGluIHRoaXMgYnJvd3NlcicpXG4gIH1cbn1cblxuLy8gSEVMUEVSIEZVTkNUSU9OU1xuLy8gPT09PT09PT09PT09PT09PVxuXG5mdW5jdGlvbiBzdHJpbmd0cmltIChzdHIpIHtcbiAgaWYgKHN0ci50cmltKSByZXR1cm4gc3RyLnRyaW0oKVxuICByZXR1cm4gc3RyLnJlcGxhY2UoL15cXHMrfFxccyskL2csICcnKVxufVxuXG52YXIgQlAgPSBCdWZmZXIucHJvdG90eXBlXG5cbi8qKlxuICogQXVnbWVudCBhIFVpbnQ4QXJyYXkgKmluc3RhbmNlKiAobm90IHRoZSBVaW50OEFycmF5IGNsYXNzISkgd2l0aCBCdWZmZXIgbWV0aG9kc1xuICovXG5CdWZmZXIuX2F1Z21lbnQgPSBmdW5jdGlvbiAoYXJyKSB7XG4gIGFyci5faXNCdWZmZXIgPSB0cnVlXG5cbiAgLy8gc2F2ZSByZWZlcmVuY2UgdG8gb3JpZ2luYWwgVWludDhBcnJheSBnZXQvc2V0IG1ldGhvZHMgYmVmb3JlIG92ZXJ3cml0aW5nXG4gIGFyci5fZ2V0ID0gYXJyLmdldFxuICBhcnIuX3NldCA9IGFyci5zZXRcblxuICAvLyBkZXByZWNhdGVkLCB3aWxsIGJlIHJlbW92ZWQgaW4gbm9kZSAwLjEzK1xuICBhcnIuZ2V0ID0gQlAuZ2V0XG4gIGFyci5zZXQgPSBCUC5zZXRcblxuICBhcnIud3JpdGUgPSBCUC53cml0ZVxuICBhcnIudG9TdHJpbmcgPSBCUC50b1N0cmluZ1xuICBhcnIudG9Mb2NhbGVTdHJpbmcgPSBCUC50b1N0cmluZ1xuICBhcnIudG9KU09OID0gQlAudG9KU09OXG4gIGFyci5jb3B5ID0gQlAuY29weVxuICBhcnIuc2xpY2UgPSBCUC5zbGljZVxuICBhcnIucmVhZFVJbnQ4ID0gQlAucmVhZFVJbnQ4XG4gIGFyci5yZWFkVUludDE2TEUgPSBCUC5yZWFkVUludDE2TEVcbiAgYXJyLnJlYWRVSW50MTZCRSA9IEJQLnJlYWRVSW50MTZCRVxuICBhcnIucmVhZFVJbnQzMkxFID0gQlAucmVhZFVJbnQzMkxFXG4gIGFyci5yZWFkVUludDMyQkUgPSBCUC5yZWFkVUludDMyQkVcbiAgYXJyLnJlYWRJbnQ4ID0gQlAucmVhZEludDhcbiAgYXJyLnJlYWRJbnQxNkxFID0gQlAucmVhZEludDE2TEVcbiAgYXJyLnJlYWRJbnQxNkJFID0gQlAucmVhZEludDE2QkVcbiAgYXJyLnJlYWRJbnQzMkxFID0gQlAucmVhZEludDMyTEVcbiAgYXJyLnJlYWRJbnQzMkJFID0gQlAucmVhZEludDMyQkVcbiAgYXJyLnJlYWRGbG9hdExFID0gQlAucmVhZEZsb2F0TEVcbiAgYXJyLnJlYWRGbG9hdEJFID0gQlAucmVhZEZsb2F0QkVcbiAgYXJyLnJlYWREb3VibGVMRSA9IEJQLnJlYWREb3VibGVMRVxuICBhcnIucmVhZERvdWJsZUJFID0gQlAucmVhZERvdWJsZUJFXG4gIGFyci53cml0ZVVJbnQ4ID0gQlAud3JpdGVVSW50OFxuICBhcnIud3JpdGVVSW50MTZMRSA9IEJQLndyaXRlVUludDE2TEVcbiAgYXJyLndyaXRlVUludDE2QkUgPSBCUC53cml0ZVVJbnQxNkJFXG4gIGFyci53cml0ZVVJbnQzMkxFID0gQlAud3JpdGVVSW50MzJMRVxuICBhcnIud3JpdGVVSW50MzJCRSA9IEJQLndyaXRlVUludDMyQkVcbiAgYXJyLndyaXRlSW50OCA9IEJQLndyaXRlSW50OFxuICBhcnIud3JpdGVJbnQxNkxFID0gQlAud3JpdGVJbnQxNkxFXG4gIGFyci53cml0ZUludDE2QkUgPSBCUC53cml0ZUludDE2QkVcbiAgYXJyLndyaXRlSW50MzJMRSA9IEJQLndyaXRlSW50MzJMRVxuICBhcnIud3JpdGVJbnQzMkJFID0gQlAud3JpdGVJbnQzMkJFXG4gIGFyci53cml0ZUZsb2F0TEUgPSBCUC53cml0ZUZsb2F0TEVcbiAgYXJyLndyaXRlRmxvYXRCRSA9IEJQLndyaXRlRmxvYXRCRVxuICBhcnIud3JpdGVEb3VibGVMRSA9IEJQLndyaXRlRG91YmxlTEVcbiAgYXJyLndyaXRlRG91YmxlQkUgPSBCUC53cml0ZURvdWJsZUJFXG4gIGFyci5maWxsID0gQlAuZmlsbFxuICBhcnIuaW5zcGVjdCA9IEJQLmluc3BlY3RcbiAgYXJyLnRvQXJyYXlCdWZmZXIgPSBCUC50b0FycmF5QnVmZmVyXG5cbiAgcmV0dXJuIGFyclxufVxuXG4vLyBzbGljZShzdGFydCwgZW5kKVxuZnVuY3Rpb24gY2xhbXAgKGluZGV4LCBsZW4sIGRlZmF1bHRWYWx1ZSkge1xuICBpZiAodHlwZW9mIGluZGV4ICE9PSAnbnVtYmVyJykgcmV0dXJuIGRlZmF1bHRWYWx1ZVxuICBpbmRleCA9IH5+aW5kZXg7ICAvLyBDb2VyY2UgdG8gaW50ZWdlci5cbiAgaWYgKGluZGV4ID49IGxlbikgcmV0dXJuIGxlblxuICBpZiAoaW5kZXggPj0gMCkgcmV0dXJuIGluZGV4XG4gIGluZGV4ICs9IGxlblxuICBpZiAoaW5kZXggPj0gMCkgcmV0dXJuIGluZGV4XG4gIHJldHVybiAwXG59XG5cbmZ1bmN0aW9uIGNvZXJjZSAobGVuZ3RoKSB7XG4gIC8vIENvZXJjZSBsZW5ndGggdG8gYSBudW1iZXIgKHBvc3NpYmx5IE5hTiksIHJvdW5kIHVwXG4gIC8vIGluIGNhc2UgaXQncyBmcmFjdGlvbmFsIChlLmcuIDEyMy40NTYpIHRoZW4gZG8gYVxuICAvLyBkb3VibGUgbmVnYXRlIHRvIGNvZXJjZSBhIE5hTiB0byAwLiBFYXN5LCByaWdodD9cbiAgbGVuZ3RoID0gfn5NYXRoLmNlaWwoK2xlbmd0aClcbiAgcmV0dXJuIGxlbmd0aCA8IDAgPyAwIDogbGVuZ3RoXG59XG5cbmZ1bmN0aW9uIGlzQXJyYXkgKHN1YmplY3QpIHtcbiAgcmV0dXJuIChBcnJheS5pc0FycmF5IHx8IGZ1bmN0aW9uIChzdWJqZWN0KSB7XG4gICAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChzdWJqZWN0KSA9PT0gJ1tvYmplY3QgQXJyYXldJ1xuICB9KShzdWJqZWN0KVxufVxuXG5mdW5jdGlvbiBpc0FycmF5aXNoIChzdWJqZWN0KSB7XG4gIHJldHVybiBpc0FycmF5KHN1YmplY3QpIHx8IEJ1ZmZlci5pc0J1ZmZlcihzdWJqZWN0KSB8fFxuICAgICAgc3ViamVjdCAmJiB0eXBlb2Ygc3ViamVjdCA9PT0gJ29iamVjdCcgJiZcbiAgICAgIHR5cGVvZiBzdWJqZWN0Lmxlbmd0aCA9PT0gJ251bWJlcidcbn1cblxuZnVuY3Rpb24gdG9IZXggKG4pIHtcbiAgaWYgKG4gPCAxNikgcmV0dXJuICcwJyArIG4udG9TdHJpbmcoMTYpXG4gIHJldHVybiBuLnRvU3RyaW5nKDE2KVxufVxuXG5mdW5jdGlvbiB1dGY4VG9CeXRlcyAoc3RyKSB7XG4gIHZhciBieXRlQXJyYXkgPSBbXVxuICBmb3IgKHZhciBpID0gMDsgaSA8IHN0ci5sZW5ndGg7IGkrKykge1xuICAgIHZhciBiID0gc3RyLmNoYXJDb2RlQXQoaSlcbiAgICBpZiAoYiA8PSAweDdGKVxuICAgICAgYnl0ZUFycmF5LnB1c2goc3RyLmNoYXJDb2RlQXQoaSkpXG4gICAgZWxzZSB7XG4gICAgICB2YXIgc3RhcnQgPSBpXG4gICAgICBpZiAoYiA+PSAweEQ4MDAgJiYgYiA8PSAweERGRkYpIGkrK1xuICAgICAgdmFyIGggPSBlbmNvZGVVUklDb21wb25lbnQoc3RyLnNsaWNlKHN0YXJ0LCBpKzEpKS5zdWJzdHIoMSkuc3BsaXQoJyUnKVxuICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBoLmxlbmd0aDsgaisrKVxuICAgICAgICBieXRlQXJyYXkucHVzaChwYXJzZUludChoW2pdLCAxNikpXG4gICAgfVxuICB9XG4gIHJldHVybiBieXRlQXJyYXlcbn1cblxuZnVuY3Rpb24gYXNjaWlUb0J5dGVzIChzdHIpIHtcbiAgdmFyIGJ5dGVBcnJheSA9IFtdXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgaSsrKSB7XG4gICAgLy8gTm9kZSdzIGNvZGUgc2VlbXMgdG8gYmUgZG9pbmcgdGhpcyBhbmQgbm90ICYgMHg3Ri4uXG4gICAgYnl0ZUFycmF5LnB1c2goc3RyLmNoYXJDb2RlQXQoaSkgJiAweEZGKVxuICB9XG4gIHJldHVybiBieXRlQXJyYXlcbn1cblxuZnVuY3Rpb24gdXRmMTZsZVRvQnl0ZXMgKHN0cikge1xuICB2YXIgYywgaGksIGxvXG4gIHZhciBieXRlQXJyYXkgPSBbXVxuICBmb3IgKHZhciBpID0gMDsgaSA8IHN0ci5sZW5ndGg7IGkrKykge1xuICAgIGMgPSBzdHIuY2hhckNvZGVBdChpKVxuICAgIGhpID0gYyA+PiA4XG4gICAgbG8gPSBjICUgMjU2XG4gICAgYnl0ZUFycmF5LnB1c2gobG8pXG4gICAgYnl0ZUFycmF5LnB1c2goaGkpXG4gIH1cblxuICByZXR1cm4gYnl0ZUFycmF5XG59XG5cbmZ1bmN0aW9uIGJhc2U2NFRvQnl0ZXMgKHN0cikge1xuICByZXR1cm4gYmFzZTY0LnRvQnl0ZUFycmF5KHN0cilcbn1cblxuZnVuY3Rpb24gYmxpdEJ1ZmZlciAoc3JjLCBkc3QsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHZhciBwb3NcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIGlmICgoaSArIG9mZnNldCA+PSBkc3QubGVuZ3RoKSB8fCAoaSA+PSBzcmMubGVuZ3RoKSlcbiAgICAgIGJyZWFrXG4gICAgZHN0W2kgKyBvZmZzZXRdID0gc3JjW2ldXG4gIH1cbiAgcmV0dXJuIGlcbn1cblxuZnVuY3Rpb24gZGVjb2RlVXRmOENoYXIgKHN0cikge1xuICB0cnkge1xuICAgIHJldHVybiBkZWNvZGVVUklDb21wb25lbnQoc3RyKVxuICB9IGNhdGNoIChlcnIpIHtcbiAgICByZXR1cm4gU3RyaW5nLmZyb21DaGFyQ29kZSgweEZGRkQpIC8vIFVURiA4IGludmFsaWQgY2hhclxuICB9XG59XG5cbi8qXG4gKiBXZSBoYXZlIHRvIG1ha2Ugc3VyZSB0aGF0IHRoZSB2YWx1ZSBpcyBhIHZhbGlkIGludGVnZXIuIFRoaXMgbWVhbnMgdGhhdCBpdFxuICogaXMgbm9uLW5lZ2F0aXZlLiBJdCBoYXMgbm8gZnJhY3Rpb25hbCBjb21wb25lbnQgYW5kIHRoYXQgaXQgZG9lcyBub3RcbiAqIGV4Y2VlZCB0aGUgbWF4aW11bSBhbGxvd2VkIHZhbHVlLlxuICovXG5mdW5jdGlvbiB2ZXJpZnVpbnQgKHZhbHVlLCBtYXgpIHtcbiAgYXNzZXJ0KHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicsICdjYW5ub3Qgd3JpdGUgYSBub24tbnVtYmVyIGFzIGEgbnVtYmVyJylcbiAgYXNzZXJ0KHZhbHVlID49IDAsICdzcGVjaWZpZWQgYSBuZWdhdGl2ZSB2YWx1ZSBmb3Igd3JpdGluZyBhbiB1bnNpZ25lZCB2YWx1ZScpXG4gIGFzc2VydCh2YWx1ZSA8PSBtYXgsICd2YWx1ZSBpcyBsYXJnZXIgdGhhbiBtYXhpbXVtIHZhbHVlIGZvciB0eXBlJylcbiAgYXNzZXJ0KE1hdGguZmxvb3IodmFsdWUpID09PSB2YWx1ZSwgJ3ZhbHVlIGhhcyBhIGZyYWN0aW9uYWwgY29tcG9uZW50Jylcbn1cblxuZnVuY3Rpb24gdmVyaWZzaW50ICh2YWx1ZSwgbWF4LCBtaW4pIHtcbiAgYXNzZXJ0KHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicsICdjYW5ub3Qgd3JpdGUgYSBub24tbnVtYmVyIGFzIGEgbnVtYmVyJylcbiAgYXNzZXJ0KHZhbHVlIDw9IG1heCwgJ3ZhbHVlIGxhcmdlciB0aGFuIG1heGltdW0gYWxsb3dlZCB2YWx1ZScpXG4gIGFzc2VydCh2YWx1ZSA+PSBtaW4sICd2YWx1ZSBzbWFsbGVyIHRoYW4gbWluaW11bSBhbGxvd2VkIHZhbHVlJylcbiAgYXNzZXJ0KE1hdGguZmxvb3IodmFsdWUpID09PSB2YWx1ZSwgJ3ZhbHVlIGhhcyBhIGZyYWN0aW9uYWwgY29tcG9uZW50Jylcbn1cblxuZnVuY3Rpb24gdmVyaWZJRUVFNzU0ICh2YWx1ZSwgbWF4LCBtaW4pIHtcbiAgYXNzZXJ0KHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicsICdjYW5ub3Qgd3JpdGUgYSBub24tbnVtYmVyIGFzIGEgbnVtYmVyJylcbiAgYXNzZXJ0KHZhbHVlIDw9IG1heCwgJ3ZhbHVlIGxhcmdlciB0aGFuIG1heGltdW0gYWxsb3dlZCB2YWx1ZScpXG4gIGFzc2VydCh2YWx1ZSA+PSBtaW4sICd2YWx1ZSBzbWFsbGVyIHRoYW4gbWluaW11bSBhbGxvd2VkIHZhbHVlJylcbn1cblxuZnVuY3Rpb24gYXNzZXJ0ICh0ZXN0LCBtZXNzYWdlKSB7XG4gIGlmICghdGVzdCkgdGhyb3cgbmV3IEVycm9yKG1lc3NhZ2UgfHwgJ0ZhaWxlZCBhc3NlcnRpb24nKVxufVxuXG59KS5jYWxsKHRoaXMscmVxdWlyZShcIis3WkpwMFwiKSx0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30scmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIsYXJndW1lbnRzWzNdLGFyZ3VtZW50c1s0XSxhcmd1bWVudHNbNV0sYXJndW1lbnRzWzZdLFwiLy4uLy4uLy4uL25vZGVfbW9kdWxlcy9ndWxwLWJyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9pbmRleC5qc1wiLFwiLy4uLy4uLy4uL25vZGVfbW9kdWxlcy9ndWxwLWJyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlclwiKSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbnZhciBsb29rdXAgPSAnQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODkrLyc7XG5cbjsoZnVuY3Rpb24gKGV4cG9ydHMpIHtcblx0J3VzZSBzdHJpY3QnO1xuXG4gIHZhciBBcnIgPSAodHlwZW9mIFVpbnQ4QXJyYXkgIT09ICd1bmRlZmluZWQnKVxuICAgID8gVWludDhBcnJheVxuICAgIDogQXJyYXlcblxuXHR2YXIgUExVUyAgID0gJysnLmNoYXJDb2RlQXQoMClcblx0dmFyIFNMQVNIICA9ICcvJy5jaGFyQ29kZUF0KDApXG5cdHZhciBOVU1CRVIgPSAnMCcuY2hhckNvZGVBdCgwKVxuXHR2YXIgTE9XRVIgID0gJ2EnLmNoYXJDb2RlQXQoMClcblx0dmFyIFVQUEVSICA9ICdBJy5jaGFyQ29kZUF0KDApXG5cblx0ZnVuY3Rpb24gZGVjb2RlIChlbHQpIHtcblx0XHR2YXIgY29kZSA9IGVsdC5jaGFyQ29kZUF0KDApXG5cdFx0aWYgKGNvZGUgPT09IFBMVVMpXG5cdFx0XHRyZXR1cm4gNjIgLy8gJysnXG5cdFx0aWYgKGNvZGUgPT09IFNMQVNIKVxuXHRcdFx0cmV0dXJuIDYzIC8vICcvJ1xuXHRcdGlmIChjb2RlIDwgTlVNQkVSKVxuXHRcdFx0cmV0dXJuIC0xIC8vbm8gbWF0Y2hcblx0XHRpZiAoY29kZSA8IE5VTUJFUiArIDEwKVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBOVU1CRVIgKyAyNiArIDI2XG5cdFx0aWYgKGNvZGUgPCBVUFBFUiArIDI2KVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBVUFBFUlxuXHRcdGlmIChjb2RlIDwgTE9XRVIgKyAyNilcblx0XHRcdHJldHVybiBjb2RlIC0gTE9XRVIgKyAyNlxuXHR9XG5cblx0ZnVuY3Rpb24gYjY0VG9CeXRlQXJyYXkgKGI2NCkge1xuXHRcdHZhciBpLCBqLCBsLCB0bXAsIHBsYWNlSG9sZGVycywgYXJyXG5cblx0XHRpZiAoYjY0Lmxlbmd0aCAlIDQgPiAwKSB7XG5cdFx0XHR0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgc3RyaW5nLiBMZW5ndGggbXVzdCBiZSBhIG11bHRpcGxlIG9mIDQnKVxuXHRcdH1cblxuXHRcdC8vIHRoZSBudW1iZXIgb2YgZXF1YWwgc2lnbnMgKHBsYWNlIGhvbGRlcnMpXG5cdFx0Ly8gaWYgdGhlcmUgYXJlIHR3byBwbGFjZWhvbGRlcnMsIHRoYW4gdGhlIHR3byBjaGFyYWN0ZXJzIGJlZm9yZSBpdFxuXHRcdC8vIHJlcHJlc2VudCBvbmUgYnl0ZVxuXHRcdC8vIGlmIHRoZXJlIGlzIG9ubHkgb25lLCB0aGVuIHRoZSB0aHJlZSBjaGFyYWN0ZXJzIGJlZm9yZSBpdCByZXByZXNlbnQgMiBieXRlc1xuXHRcdC8vIHRoaXMgaXMganVzdCBhIGNoZWFwIGhhY2sgdG8gbm90IGRvIGluZGV4T2YgdHdpY2Vcblx0XHR2YXIgbGVuID0gYjY0Lmxlbmd0aFxuXHRcdHBsYWNlSG9sZGVycyA9ICc9JyA9PT0gYjY0LmNoYXJBdChsZW4gLSAyKSA/IDIgOiAnPScgPT09IGI2NC5jaGFyQXQobGVuIC0gMSkgPyAxIDogMFxuXG5cdFx0Ly8gYmFzZTY0IGlzIDQvMyArIHVwIHRvIHR3byBjaGFyYWN0ZXJzIG9mIHRoZSBvcmlnaW5hbCBkYXRhXG5cdFx0YXJyID0gbmV3IEFycihiNjQubGVuZ3RoICogMyAvIDQgLSBwbGFjZUhvbGRlcnMpXG5cblx0XHQvLyBpZiB0aGVyZSBhcmUgcGxhY2Vob2xkZXJzLCBvbmx5IGdldCB1cCB0byB0aGUgbGFzdCBjb21wbGV0ZSA0IGNoYXJzXG5cdFx0bCA9IHBsYWNlSG9sZGVycyA+IDAgPyBiNjQubGVuZ3RoIC0gNCA6IGI2NC5sZW5ndGhcblxuXHRcdHZhciBMID0gMFxuXG5cdFx0ZnVuY3Rpb24gcHVzaCAodikge1xuXHRcdFx0YXJyW0wrK10gPSB2XG5cdFx0fVxuXG5cdFx0Zm9yIChpID0gMCwgaiA9IDA7IGkgPCBsOyBpICs9IDQsIGogKz0gMykge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAxOCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA8PCAxMikgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDIpKSA8PCA2KSB8IGRlY29kZShiNjQuY2hhckF0KGkgKyAzKSlcblx0XHRcdHB1c2goKHRtcCAmIDB4RkYwMDAwKSA+PiAxNilcblx0XHRcdHB1c2goKHRtcCAmIDB4RkYwMCkgPj4gOClcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9XG5cblx0XHRpZiAocGxhY2VIb2xkZXJzID09PSAyKSB7XG5cdFx0XHR0bXAgPSAoZGVjb2RlKGI2NC5jaGFyQXQoaSkpIDw8IDIpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAxKSkgPj4gNClcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9IGVsc2UgaWYgKHBsYWNlSG9sZGVycyA9PT0gMSkge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAxMCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA8PCA0KSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMikpID4+IDIpXG5cdFx0XHRwdXNoKCh0bXAgPj4gOCkgJiAweEZGKVxuXHRcdFx0cHVzaCh0bXAgJiAweEZGKVxuXHRcdH1cblxuXHRcdHJldHVybiBhcnJcblx0fVxuXG5cdGZ1bmN0aW9uIHVpbnQ4VG9CYXNlNjQgKHVpbnQ4KSB7XG5cdFx0dmFyIGksXG5cdFx0XHRleHRyYUJ5dGVzID0gdWludDgubGVuZ3RoICUgMywgLy8gaWYgd2UgaGF2ZSAxIGJ5dGUgbGVmdCwgcGFkIDIgYnl0ZXNcblx0XHRcdG91dHB1dCA9IFwiXCIsXG5cdFx0XHR0ZW1wLCBsZW5ndGhcblxuXHRcdGZ1bmN0aW9uIGVuY29kZSAobnVtKSB7XG5cdFx0XHRyZXR1cm4gbG9va3VwLmNoYXJBdChudW0pXG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gdHJpcGxldFRvQmFzZTY0IChudW0pIHtcblx0XHRcdHJldHVybiBlbmNvZGUobnVtID4+IDE4ICYgMHgzRikgKyBlbmNvZGUobnVtID4+IDEyICYgMHgzRikgKyBlbmNvZGUobnVtID4+IDYgJiAweDNGKSArIGVuY29kZShudW0gJiAweDNGKVxuXHRcdH1cblxuXHRcdC8vIGdvIHRocm91Z2ggdGhlIGFycmF5IGV2ZXJ5IHRocmVlIGJ5dGVzLCB3ZSdsbCBkZWFsIHdpdGggdHJhaWxpbmcgc3R1ZmYgbGF0ZXJcblx0XHRmb3IgKGkgPSAwLCBsZW5ndGggPSB1aW50OC5sZW5ndGggLSBleHRyYUJ5dGVzOyBpIDwgbGVuZ3RoOyBpICs9IDMpIHtcblx0XHRcdHRlbXAgPSAodWludDhbaV0gPDwgMTYpICsgKHVpbnQ4W2kgKyAxXSA8PCA4KSArICh1aW50OFtpICsgMl0pXG5cdFx0XHRvdXRwdXQgKz0gdHJpcGxldFRvQmFzZTY0KHRlbXApXG5cdFx0fVxuXG5cdFx0Ly8gcGFkIHRoZSBlbmQgd2l0aCB6ZXJvcywgYnV0IG1ha2Ugc3VyZSB0byBub3QgZm9yZ2V0IHRoZSBleHRyYSBieXRlc1xuXHRcdHN3aXRjaCAoZXh0cmFCeXRlcykge1xuXHRcdFx0Y2FzZSAxOlxuXHRcdFx0XHR0ZW1wID0gdWludDhbdWludDgubGVuZ3RoIC0gMV1cblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSh0ZW1wID4+IDIpXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPDwgNCkgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gJz09J1xuXHRcdFx0XHRicmVha1xuXHRcdFx0Y2FzZSAyOlxuXHRcdFx0XHR0ZW1wID0gKHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDJdIDw8IDgpICsgKHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDFdKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKHRlbXAgPj4gMTApXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPj4gNCkgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKCh0ZW1wIDw8IDIpICYgMHgzRilcblx0XHRcdFx0b3V0cHV0ICs9ICc9J1xuXHRcdFx0XHRicmVha1xuXHRcdH1cblxuXHRcdHJldHVybiBvdXRwdXRcblx0fVxuXG5cdGV4cG9ydHMudG9CeXRlQXJyYXkgPSBiNjRUb0J5dGVBcnJheVxuXHRleHBvcnRzLmZyb21CeXRlQXJyYXkgPSB1aW50OFRvQmFzZTY0XG59KHR5cGVvZiBleHBvcnRzID09PSAndW5kZWZpbmVkJyA/ICh0aGlzLmJhc2U2NGpzID0ge30pIDogZXhwb3J0cykpXG5cbn0pLmNhbGwodGhpcyxyZXF1aXJlKFwiKzdaSnAwXCIpLHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvLi4vLi4vLi4vbm9kZV9tb2R1bGVzL2d1bHAtYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL25vZGVfbW9kdWxlcy9iYXNlNjQtanMvbGliL2I2NC5qc1wiLFwiLy4uLy4uLy4uL25vZGVfbW9kdWxlcy9ndWxwLWJyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9ub2RlX21vZHVsZXMvYmFzZTY0LWpzL2xpYlwiKSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbmV4cG9ydHMucmVhZCA9IGZ1bmN0aW9uKGJ1ZmZlciwgb2Zmc2V0LCBpc0xFLCBtTGVuLCBuQnl0ZXMpIHtcbiAgdmFyIGUsIG0sXG4gICAgICBlTGVuID0gbkJ5dGVzICogOCAtIG1MZW4gLSAxLFxuICAgICAgZU1heCA9ICgxIDw8IGVMZW4pIC0gMSxcbiAgICAgIGVCaWFzID0gZU1heCA+PiAxLFxuICAgICAgbkJpdHMgPSAtNyxcbiAgICAgIGkgPSBpc0xFID8gKG5CeXRlcyAtIDEpIDogMCxcbiAgICAgIGQgPSBpc0xFID8gLTEgOiAxLFxuICAgICAgcyA9IGJ1ZmZlcltvZmZzZXQgKyBpXTtcblxuICBpICs9IGQ7XG5cbiAgZSA9IHMgJiAoKDEgPDwgKC1uQml0cykpIC0gMSk7XG4gIHMgPj49ICgtbkJpdHMpO1xuICBuQml0cyArPSBlTGVuO1xuICBmb3IgKDsgbkJpdHMgPiAwOyBlID0gZSAqIDI1NiArIGJ1ZmZlcltvZmZzZXQgKyBpXSwgaSArPSBkLCBuQml0cyAtPSA4KTtcblxuICBtID0gZSAmICgoMSA8PCAoLW5CaXRzKSkgLSAxKTtcbiAgZSA+Pj0gKC1uQml0cyk7XG4gIG5CaXRzICs9IG1MZW47XG4gIGZvciAoOyBuQml0cyA+IDA7IG0gPSBtICogMjU2ICsgYnVmZmVyW29mZnNldCArIGldLCBpICs9IGQsIG5CaXRzIC09IDgpO1xuXG4gIGlmIChlID09PSAwKSB7XG4gICAgZSA9IDEgLSBlQmlhcztcbiAgfSBlbHNlIGlmIChlID09PSBlTWF4KSB7XG4gICAgcmV0dXJuIG0gPyBOYU4gOiAoKHMgPyAtMSA6IDEpICogSW5maW5pdHkpO1xuICB9IGVsc2Uge1xuICAgIG0gPSBtICsgTWF0aC5wb3coMiwgbUxlbik7XG4gICAgZSA9IGUgLSBlQmlhcztcbiAgfVxuICByZXR1cm4gKHMgPyAtMSA6IDEpICogbSAqIE1hdGgucG93KDIsIGUgLSBtTGVuKTtcbn07XG5cbmV4cG9ydHMud3JpdGUgPSBmdW5jdGlvbihidWZmZXIsIHZhbHVlLCBvZmZzZXQsIGlzTEUsIG1MZW4sIG5CeXRlcykge1xuICB2YXIgZSwgbSwgYyxcbiAgICAgIGVMZW4gPSBuQnl0ZXMgKiA4IC0gbUxlbiAtIDEsXG4gICAgICBlTWF4ID0gKDEgPDwgZUxlbikgLSAxLFxuICAgICAgZUJpYXMgPSBlTWF4ID4+IDEsXG4gICAgICBydCA9IChtTGVuID09PSAyMyA/IE1hdGgucG93KDIsIC0yNCkgLSBNYXRoLnBvdygyLCAtNzcpIDogMCksXG4gICAgICBpID0gaXNMRSA/IDAgOiAobkJ5dGVzIC0gMSksXG4gICAgICBkID0gaXNMRSA/IDEgOiAtMSxcbiAgICAgIHMgPSB2YWx1ZSA8IDAgfHwgKHZhbHVlID09PSAwICYmIDEgLyB2YWx1ZSA8IDApID8gMSA6IDA7XG5cbiAgdmFsdWUgPSBNYXRoLmFicyh2YWx1ZSk7XG5cbiAgaWYgKGlzTmFOKHZhbHVlKSB8fCB2YWx1ZSA9PT0gSW5maW5pdHkpIHtcbiAgICBtID0gaXNOYU4odmFsdWUpID8gMSA6IDA7XG4gICAgZSA9IGVNYXg7XG4gIH0gZWxzZSB7XG4gICAgZSA9IE1hdGguZmxvb3IoTWF0aC5sb2codmFsdWUpIC8gTWF0aC5MTjIpO1xuICAgIGlmICh2YWx1ZSAqIChjID0gTWF0aC5wb3coMiwgLWUpKSA8IDEpIHtcbiAgICAgIGUtLTtcbiAgICAgIGMgKj0gMjtcbiAgICB9XG4gICAgaWYgKGUgKyBlQmlhcyA+PSAxKSB7XG4gICAgICB2YWx1ZSArPSBydCAvIGM7XG4gICAgfSBlbHNlIHtcbiAgICAgIHZhbHVlICs9IHJ0ICogTWF0aC5wb3coMiwgMSAtIGVCaWFzKTtcbiAgICB9XG4gICAgaWYgKHZhbHVlICogYyA+PSAyKSB7XG4gICAgICBlKys7XG4gICAgICBjIC89IDI7XG4gICAgfVxuXG4gICAgaWYgKGUgKyBlQmlhcyA+PSBlTWF4KSB7XG4gICAgICBtID0gMDtcbiAgICAgIGUgPSBlTWF4O1xuICAgIH0gZWxzZSBpZiAoZSArIGVCaWFzID49IDEpIHtcbiAgICAgIG0gPSAodmFsdWUgKiBjIC0gMSkgKiBNYXRoLnBvdygyLCBtTGVuKTtcbiAgICAgIGUgPSBlICsgZUJpYXM7XG4gICAgfSBlbHNlIHtcbiAgICAgIG0gPSB2YWx1ZSAqIE1hdGgucG93KDIsIGVCaWFzIC0gMSkgKiBNYXRoLnBvdygyLCBtTGVuKTtcbiAgICAgIGUgPSAwO1xuICAgIH1cbiAgfVxuXG4gIGZvciAoOyBtTGVuID49IDg7IGJ1ZmZlcltvZmZzZXQgKyBpXSA9IG0gJiAweGZmLCBpICs9IGQsIG0gLz0gMjU2LCBtTGVuIC09IDgpO1xuXG4gIGUgPSAoZSA8PCBtTGVuKSB8IG07XG4gIGVMZW4gKz0gbUxlbjtcbiAgZm9yICg7IGVMZW4gPiAwOyBidWZmZXJbb2Zmc2V0ICsgaV0gPSBlICYgMHhmZiwgaSArPSBkLCBlIC89IDI1NiwgZUxlbiAtPSA4KTtcblxuICBidWZmZXJbb2Zmc2V0ICsgaSAtIGRdIHw9IHMgKiAxMjg7XG59O1xuXG59KS5jYWxsKHRoaXMscmVxdWlyZShcIis3WkpwMFwiKSx0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30scmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIsYXJndW1lbnRzWzNdLGFyZ3VtZW50c1s0XSxhcmd1bWVudHNbNV0sYXJndW1lbnRzWzZdLFwiLy4uLy4uLy4uL25vZGVfbW9kdWxlcy9ndWxwLWJyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9ub2RlX21vZHVsZXMvaWVlZTc1NC9pbmRleC5qc1wiLFwiLy4uLy4uLy4uL25vZGVfbW9kdWxlcy9ndWxwLWJyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9ub2RlX21vZHVsZXMvaWVlZTc1NFwiKSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbi8vIHNoaW0gZm9yIHVzaW5nIHByb2Nlc3MgaW4gYnJvd3NlclxuXG52YXIgcHJvY2VzcyA9IG1vZHVsZS5leHBvcnRzID0ge307XG5cbnByb2Nlc3MubmV4dFRpY2sgPSAoZnVuY3Rpb24gKCkge1xuICAgIHZhciBjYW5TZXRJbW1lZGlhdGUgPSB0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJ1xuICAgICYmIHdpbmRvdy5zZXRJbW1lZGlhdGU7XG4gICAgdmFyIGNhblBvc3QgPSB0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJ1xuICAgICYmIHdpbmRvdy5wb3N0TWVzc2FnZSAmJiB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lclxuICAgIDtcblxuICAgIGlmIChjYW5TZXRJbW1lZGlhdGUpIHtcbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uIChmKSB7IHJldHVybiB3aW5kb3cuc2V0SW1tZWRpYXRlKGYpIH07XG4gICAgfVxuXG4gICAgaWYgKGNhblBvc3QpIHtcbiAgICAgICAgdmFyIHF1ZXVlID0gW107XG4gICAgICAgIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCdtZXNzYWdlJywgZnVuY3Rpb24gKGV2KSB7XG4gICAgICAgICAgICB2YXIgc291cmNlID0gZXYuc291cmNlO1xuICAgICAgICAgICAgaWYgKChzb3VyY2UgPT09IHdpbmRvdyB8fCBzb3VyY2UgPT09IG51bGwpICYmIGV2LmRhdGEgPT09ICdwcm9jZXNzLXRpY2snKSB7XG4gICAgICAgICAgICAgICAgZXYuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgICAgICAgICAgaWYgKHF1ZXVlLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGZuID0gcXVldWUuc2hpZnQoKTtcbiAgICAgICAgICAgICAgICAgICAgZm4oKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sIHRydWUpO1xuXG4gICAgICAgIHJldHVybiBmdW5jdGlvbiBuZXh0VGljayhmbikge1xuICAgICAgICAgICAgcXVldWUucHVzaChmbik7XG4gICAgICAgICAgICB3aW5kb3cucG9zdE1lc3NhZ2UoJ3Byb2Nlc3MtdGljaycsICcqJyk7XG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgcmV0dXJuIGZ1bmN0aW9uIG5leHRUaWNrKGZuKSB7XG4gICAgICAgIHNldFRpbWVvdXQoZm4sIDApO1xuICAgIH07XG59KSgpO1xuXG5wcm9jZXNzLnRpdGxlID0gJ2Jyb3dzZXInO1xucHJvY2Vzcy5icm93c2VyID0gdHJ1ZTtcbnByb2Nlc3MuZW52ID0ge307XG5wcm9jZXNzLmFyZ3YgPSBbXTtcblxuZnVuY3Rpb24gbm9vcCgpIHt9XG5cbnByb2Nlc3Mub24gPSBub29wO1xucHJvY2Vzcy5hZGRMaXN0ZW5lciA9IG5vb3A7XG5wcm9jZXNzLm9uY2UgPSBub29wO1xucHJvY2Vzcy5vZmYgPSBub29wO1xucHJvY2Vzcy5yZW1vdmVMaXN0ZW5lciA9IG5vb3A7XG5wcm9jZXNzLnJlbW92ZUFsbExpc3RlbmVycyA9IG5vb3A7XG5wcm9jZXNzLmVtaXQgPSBub29wO1xuXG5wcm9jZXNzLmJpbmRpbmcgPSBmdW5jdGlvbiAobmFtZSkge1xuICAgIHRocm93IG5ldyBFcnJvcigncHJvY2Vzcy5iaW5kaW5nIGlzIG5vdCBzdXBwb3J0ZWQnKTtcbn1cblxuLy8gVE9ETyhzaHR5bG1hbilcbnByb2Nlc3MuY3dkID0gZnVuY3Rpb24gKCkgeyByZXR1cm4gJy8nIH07XG5wcm9jZXNzLmNoZGlyID0gZnVuY3Rpb24gKGRpcikge1xuICAgIHRocm93IG5ldyBFcnJvcigncHJvY2Vzcy5jaGRpciBpcyBub3Qgc3VwcG9ydGVkJyk7XG59O1xuXG59KS5jYWxsKHRoaXMscmVxdWlyZShcIis3WkpwMFwiKSx0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30scmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIsYXJndW1lbnRzWzNdLGFyZ3VtZW50c1s0XSxhcmd1bWVudHNbNV0sYXJndW1lbnRzWzZdLFwiLy4uLy4uLy4uL25vZGVfbW9kdWxlcy9ndWxwLWJyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL3Byb2Nlc3MvYnJvd3Nlci5qc1wiLFwiLy4uLy4uLy4uL25vZGVfbW9kdWxlcy9ndWxwLWJyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL3Byb2Nlc3NcIikiLCIoZnVuY3Rpb24gKHByb2Nlc3MsZ2xvYmFsLEJ1ZmZlcixfX2FyZ3VtZW50MCxfX2FyZ3VtZW50MSxfX2FyZ3VtZW50MixfX2FyZ3VtZW50MyxfX2ZpbGVuYW1lLF9fZGlybmFtZSl7XG5tb2R1bGUuZXhwb3J0cyA9IGFuZ3VsYXIubW9kdWxlKCdhcHAuY29uZmlnJywgW10pO1xuLy9yZXF1aXJlKCcuL2NvbmZpZy5qcycpO1xucmVxdWlyZSgnLi9yb3V0ZXMuanMnKTtcblxufSkuY2FsbCh0aGlzLHJlcXVpcmUoXCIrN1pKcDBcIiksdHlwZW9mIHNlbGYgIT09IFwidW5kZWZpbmVkXCIgPyBzZWxmIDogdHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiA/IHdpbmRvdyA6IHt9LHJlcXVpcmUoXCJidWZmZXJcIikuQnVmZmVyLGFyZ3VtZW50c1szXSxhcmd1bWVudHNbNF0sYXJndW1lbnRzWzVdLGFyZ3VtZW50c1s2XSxcIi8uLi9jb25maWcvX21vZHVsZV9pbml0LmpzXCIsXCIvLi4vY29uZmlnXCIpIiwiKGZ1bmN0aW9uIChwcm9jZXNzLGdsb2JhbCxCdWZmZXIsX19hcmd1bWVudDAsX19hcmd1bWVudDEsX19hcmd1bWVudDIsX19hcmd1bWVudDMsX19maWxlbmFtZSxfX2Rpcm5hbWUpe1xudmFyIG1vZHVsZSA9IHJlcXVpcmUoJy4vX21vZHVsZV9pbml0LmpzJyk7XG5tb2R1bGUuY29uZmlnKGZ1bmN0aW9uKCRzdGF0ZVByb3ZpZGVyLCAkdXJsUm91dGVyUHJvdmlkZXIsICRodHRwUHJvdmlkZXIpIHtcblx0ZGVsZXRlICRodHRwUHJvdmlkZXIuZGVmYXVsdHMuaGVhZGVycy5jb21tb25bJ1gtUmVxdWVzdGVkLVdpdGgnXTtcblx0JHVybFJvdXRlclByb3ZpZGVyLm90aGVyd2lzZSgnL2hvbWUnKTsgLy9ERUZBVUxUXG59KTtcblxubW9kdWxlLnJ1bihbXG5cdCckUUpIZWxwZXJGdW5jdGlvbnMnLCAnJFFKTG9nZ2VyJywgJyRRSkFwaScsICckcm9vdFNjb3BlJywgJyRsb2NhdGlvbicsICckdXJsUm91dGVyJywgJyRzdGF0ZScsICckdGltZW91dCcsXG5cdGZ1bmN0aW9uKCRRSkhlbHBlckZ1bmN0aW9ucywgJFFKTG9nZ2VyLCAkUUpBcGksICRyb290U2NvcGUsICRsb2NhdGlvbiwgJHVybFJvdXRlciwgJHN0YXRlLCAkdGltZW91dCkge1xuXG5cdFx0JHJvb3RTY29wZS4kb24oJyRzdGF0ZUNoYW5nZVN0YXJ0JywgZnVuY3Rpb24oZXZlbnQsIHRvU3RhdGUsIHRvUGFyYW1zLCBmcm9tU3RhdGUsIGZyb21QYXJhbXMpIHtcblx0XHRcdC8vXG5cdFx0XHR2YXIgbG9nZ2VkID0gJHJvb3RTY29wZS5zZXNzaW9uLnRva2VuICE9IG51bGw7XG5cdFx0XHRpZiAodG9TdGF0ZS5uYW1lICE9IFwibG9naW5cIiAmJiAhbG9nZ2VkKSB7XG5cdFx0XHRcdCRRSkxvZ2dlci5sb2coJ3J1biAtPiBzdGF0ZSAtPiBmb3JjZSByZWRpcmVjdGlvbicpO1xuXHRcdFx0XHRldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuXHRcdFx0XHQkUUpIZWxwZXJGdW5jdGlvbnMuY2hhbmdlU3RhdGUoJ2xvZ2luJyk7XG5cdFx0XHR9XG5cdFx0XHQvL1xuXHRcdH0pO1xuXG5cdH1cbl0pO1xuXG5tb2R1bGUuY29uZmlnKGZ1bmN0aW9uKCRzdGF0ZVByb3ZpZGVyLCAkdXJsUm91dGVyUHJvdmlkZXIsICRodHRwUHJvdmlkZXIpIHtcblxuY29uc29sZS5pbmZvKCdbUk9VVEVTXScpO1xuXG5cdCRzdGF0ZVByb3ZpZGVyXG5cdC5zdGF0ZSgnaG9tZScsIHtcblx0XHR1cmw6ICdeL2hvbWUnLFxuXHRcdHZpZXdzOiB7XG5cdFx0XHQnJzoge1xuXHRcdFx0XHR0ZW1wbGF0ZVVybDogJ3BhZ2VzL2hvbWUuaHRtbCcsXG5cdFx0XHRcdGNvbnRyb2xsZXI6ICdIb21lQ29udHJvbGxlcidcblx0XHRcdH0sXG5cdFx0XHQnbmF2Jzoge1xuXHRcdFx0XHR0ZW1wbGF0ZVVybDogJ3BhZ2VzL25hdi5odG1sJyxcblx0XHRcdFx0Y29udHJvbGxlcjogJ05hdkNvbnRyb2xsZXInXG5cdFx0XHR9LFxuXHRcdFx0J3NpZGViYXInOiB7XG5cdFx0XHRcdHRlbXBsYXRlVXJsOiAncGFnZXMvc2lkZWJhci5odG1sJyxcblx0XHRcdFx0Y29udHJvbGxlcjogJ1NpZGViYXJDb250cm9sbGVyJ1xuXHRcdFx0fVxuXHRcdH1cblx0fSlcblxuXHQuc3RhdGUoJ2xvZ2luJywge1xuXHRcdHVybDogJ14vbG9naW4nLFxuXHRcdHZpZXdzOiB7XG5cdFx0XHQnJzoge1xuXHRcdFx0XHR0ZW1wbGF0ZVVybDogJ3BhZ2VzL2xvZ2luLmh0bWwnLFxuXHRcdFx0XHRjb250cm9sbGVyOiAnTG9naW5Db250cm9sbGVyJ1xuXHRcdFx0fSxcblx0XHRcdCduYXYnOiB7XG5cdFx0XHRcdHRlbXBsYXRlVXJsOiAncGFnZXMvZW1wdHlfbmF2Lmh0bWwnXG5cdFx0XHR9LFxuXHRcdFx0J3NpZGViYXInOiB7XG5cdFx0XHRcdHRlbXBsYXRlVXJsOiAncGFnZXMvZW1wdHkuaHRtbCdcblx0XHRcdH1cblx0XHR9XG5cdH0pXG5cblxuXG5cdC5zdGF0ZSgnZXJyb3ItcmVzcG9uc2UtaGFzLWVycm9ycycsIHtcblx0XHR1cmw6ICdeL2FwaWVycm9yaW52YWxpZHJlc3BvbnNlJyxcblx0XHR2aWV3czoge1xuXHRcdFx0Jyc6IHtcblx0XHRcdFx0dGVtcGxhdGVVcmw6ICdwYWdlcy9lcnJvcnMvYXBpLnJlc3BvbnNlLmhhcy5lcnJvcnMuaHRtbCdcblx0XHRcdH0sXG5cdFx0XHQnbmF2Jzoge1xuXHRcdFx0XHR0ZW1wbGF0ZVVybDogJ3BhZ2VzL2VtcHR5X25hdi5odG1sJ1xuXHRcdFx0fSxcblx0XHRcdCdzaWRlYmFyJzoge1xuXHRcdFx0XHR0ZW1wbGF0ZVVybDogJ3BhZ2VzL2VtcHR5Lmh0bWwnXG5cdFx0XHR9XG5cdFx0fVxuXHR9KVxuXG5cdC5zdGF0ZSgnZXJyb3ItaW52YWxpZC1yZXNwb25zZScsIHtcblx0XHR1cmw6ICdeL2FwaWVycm9yaW52YWxpZHJlc3BvbnNlJyxcblx0XHR2aWV3czoge1xuXHRcdFx0Jyc6IHtcblx0XHRcdFx0dGVtcGxhdGVVcmw6ICdwYWdlcy9lcnJvcnMvYXBpLmludmFsaWQucmVzcG9uc2UuaHRtbCdcblx0XHRcdH0sXG5cdFx0XHQnbmF2Jzoge1xuXHRcdFx0XHR0ZW1wbGF0ZVVybDogJ3BhZ2VzL2VtcHR5X25hdi5odG1sJ1xuXHRcdFx0fSxcblx0XHRcdCdzaWRlYmFyJzoge1xuXHRcdFx0XHR0ZW1wbGF0ZVVybDogJ3BhZ2VzL2VtcHR5Lmh0bWwnXG5cdFx0XHR9XG5cdFx0fVxuXHR9KVxuXG5cdC5zdGF0ZSgnZXJyb3ItYXBpJywge1xuXHRcdHVybDogJ14vYXBpZXJyb3InLFxuXHRcdHZpZXdzOiB7XG5cdFx0XHQnJzoge1xuXHRcdFx0XHR0ZW1wbGF0ZVVybDogJ3BhZ2VzL2Vycm9ycy9hcGkuaHRtbCdcblx0XHRcdH0sXG5cdFx0XHQnbmF2Jzoge1xuXHRcdFx0XHR0ZW1wbGF0ZVVybDogJ3BhZ2VzL2VtcHR5X25hdi5odG1sJ1xuXHRcdFx0fSxcblx0XHRcdCdzaWRlYmFyJzoge1xuXHRcdFx0XHR0ZW1wbGF0ZVVybDogJ3BhZ2VzL2VtcHR5Lmh0bWwnXG5cdFx0XHR9XG5cdFx0fVxuXHR9KVxuXG5cblx0Ly9NRU5VU1xuXHQuc3RhdGUoJ21vZHVsZS1tZW51LWxpc3QnLCB7XG5cdFx0dXJsOiAnXi9tZW51cycsXG5cdFx0dmlld3M6IHtcblx0XHRcdCcnOiB7XG5cdFx0XHRcdHRlbXBsYXRlVXJsOiAncGFnZXMvbWVudS9tZW51Lmxpc3QuaHRtbCcsXG5cdFx0XHRcdGNvbnRyb2xsZXI6ICdNZW51TGlzdENvbnRyb2xsZXInXG5cdFx0XHR9LFxuXHRcdFx0J25hdic6IHtcblx0XHRcdFx0dGVtcGxhdGVVcmw6ICdwYWdlcy9uYXYuaHRtbCcsXG5cdFx0XHRcdGNvbnRyb2xsZXI6ICdOYXZDb250cm9sbGVyJ1xuXHRcdFx0fSxcblx0XHRcdCdzaWRlYmFyJzoge1xuXHRcdFx0XHR0ZW1wbGF0ZVVybDogJ3BhZ2VzL3NpZGViYXIuaHRtbCcsXG5cdFx0XHRcdGNvbnRyb2xsZXI6ICdTaWRlYmFyQ29udHJvbGxlcidcblx0XHRcdH1cblx0XHR9XG5cdH0pXG5cdFx0LnN0YXRlKCdtb2R1bGUtbWVudS1lZGl0Jywge1xuXHRcdFx0dXJsOiAnXi9tZW51LzppZCcsXG5cdFx0XHR2aWV3czoge1xuXHRcdFx0XHQnJzoge1xuXHRcdFx0XHRcdHRlbXBsYXRlVXJsOiAncGFnZXMvbWVudS9tZW51LmVkaXQuaHRtbCcsXG5cdFx0XHRcdFx0Y29udHJvbGxlcjogJ01lbnVFZGl0Q29udHJvbGxlcidcblx0XHRcdFx0fSxcblx0XHRcdFx0J25hdic6IHtcblx0XHRcdFx0XHR0ZW1wbGF0ZVVybDogJ3BhZ2VzL25hdi5odG1sJyxcblx0XHRcdFx0XHRjb250cm9sbGVyOiAnTmF2Q29udHJvbGxlcidcblx0XHRcdFx0fSxcblx0XHRcdFx0J3NpZGViYXInOiB7XG5cdFx0XHRcdFx0dGVtcGxhdGVVcmw6ICdwYWdlcy9zaWRlYmFyLmh0bWwnLFxuXHRcdFx0XHRcdGNvbnRyb2xsZXI6ICdTaWRlYmFyQ29udHJvbGxlcidcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdH0pXG5cblxuXHQuc3RhdGUoJ21vZHVsZS1wcm9maWxlLWxpc3QnLCB7XG5cdFx0dXJsOiAnXi9wcm9maWxlcycsXG5cdFx0dmlld3M6IHtcblx0XHRcdCcnOiB7XG5cdFx0XHRcdHRlbXBsYXRlVXJsOiAncGFnZXMvcHJvZmlsZS9wcm9maWxlLmxpc3QuaHRtbCcsXG5cdFx0XHRcdGNvbnRyb2xsZXI6ICdQcm9maWxlTGlzdENvbnRyb2xsZXInXG5cdFx0XHR9LFxuXHRcdFx0J25hdic6IHtcblx0XHRcdFx0dGVtcGxhdGVVcmw6ICdwYWdlcy9uYXYuaHRtbCcsXG5cdFx0XHRcdGNvbnRyb2xsZXI6ICdOYXZDb250cm9sbGVyJ1xuXHRcdFx0fSxcblx0XHRcdCdzaWRlYmFyJzoge1xuXHRcdFx0XHR0ZW1wbGF0ZVVybDogJ3BhZ2VzL3NpZGViYXIuaHRtbCcsXG5cdFx0XHRcdGNvbnRyb2xsZXI6ICdTaWRlYmFyQ29udHJvbGxlcidcblx0XHRcdH1cblx0XHR9XG5cdH0pXG5cdFx0LnN0YXRlKCdtb2R1bGUtcHJvZmlsZS1lZGl0Jywge1xuXHRcdFx0dXJsOiAnXi9wcm9maWxlcy86aWQnLFxuXHRcdFx0dmlld3M6IHtcblx0XHRcdFx0Jyc6IHtcblx0XHRcdFx0XHR0ZW1wbGF0ZVVybDogJ3BhZ2VzL3Byb2ZpbGUvcHJvZmlsZS5lZGl0Lmh0bWwnLFxuXHRcdFx0XHRcdGNvbnRyb2xsZXI6ICdQcm9maWxlRWRpdENvbnRyb2xsZXInXG5cdFx0XHRcdH0sXG5cdFx0XHRcdCduYXYnOiB7XG5cdFx0XHRcdFx0dGVtcGxhdGVVcmw6ICdwYWdlcy9uYXYuaHRtbCcsXG5cdFx0XHRcdFx0Y29udHJvbGxlcjogJ05hdkNvbnRyb2xsZXInXG5cdFx0XHRcdH0sXG5cdFx0XHRcdCdzaWRlYmFyJzoge1xuXHRcdFx0XHRcdHRlbXBsYXRlVXJsOiAncGFnZXMvc2lkZWJhci5odG1sJyxcblx0XHRcdFx0XHRjb250cm9sbGVyOiAnU2lkZWJhckNvbnRyb2xsZXInXG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHR9KVxuXG5cdC5zdGF0ZSgnbW9kdWxlLXVzZXJncm91cC1saXN0Jywge1xuXHRcdHVybDogJ14vdXNlcmdyb3VwcycsXG5cdFx0dmlld3M6IHtcblx0XHRcdCcnOiB7XG5cdFx0XHRcdHRlbXBsYXRlVXJsOiAncGFnZXMvdXNlcnMvdXNlcmdyb3VwLmxpc3QuaHRtbCcsXG5cdFx0XHRcdGNvbnRyb2xsZXI6ICdVc2VyZ3JvdXBMaXN0Q29udHJvbGxlcidcblx0XHRcdH0sXG5cdFx0XHQnbmF2Jzoge1xuXHRcdFx0XHR0ZW1wbGF0ZVVybDogJ3BhZ2VzL25hdi5odG1sJyxcblx0XHRcdFx0Y29udHJvbGxlcjogJ05hdkNvbnRyb2xsZXInXG5cdFx0XHR9LFxuXHRcdFx0J3NpZGViYXInOiB7XG5cdFx0XHRcdHRlbXBsYXRlVXJsOiAncGFnZXMvc2lkZWJhci5odG1sJyxcblx0XHRcdFx0Y29udHJvbGxlcjogJ1NpZGViYXJDb250cm9sbGVyJ1xuXHRcdFx0fVxuXHRcdH1cblx0fSlcblx0XHQuc3RhdGUoJ21vZHVsZS11c2VyZ3JvdXAtZWRpdCcsIHtcblx0XHRcdHVybDogJ14vdXNlcmdyb3Vwcy86aWQnLFxuXHRcdFx0dmlld3M6IHtcblx0XHRcdFx0Jyc6IHtcblx0XHRcdFx0XHR0ZW1wbGF0ZVVybDogJ3BhZ2VzL3VzZXJzL3VzZXJncm91cC5lZGl0Lmh0bWwnLFxuXHRcdFx0XHRcdGNvbnRyb2xsZXI6ICdVc2VyZ3JvdXBFZGl0Q29udHJvbGxlcidcblx0XHRcdFx0fSxcblx0XHRcdFx0J25hdic6IHtcblx0XHRcdFx0XHR0ZW1wbGF0ZVVybDogJ3BhZ2VzL25hdi5odG1sJyxcblx0XHRcdFx0XHRjb250cm9sbGVyOiAnTmF2Q29udHJvbGxlcidcblx0XHRcdFx0fSxcblx0XHRcdFx0J3NpZGViYXInOiB7XG5cdFx0XHRcdFx0dGVtcGxhdGVVcmw6ICdwYWdlcy9zaWRlYmFyLmh0bWwnLFxuXHRcdFx0XHRcdGNvbnRyb2xsZXI6ICdTaWRlYmFyQ29udHJvbGxlcidcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdH0pXG5cblxuXG5cdC5zdGF0ZSgnbW9kdWxlLXVzZXItbGlzdCcsIHtcblx0XHR1cmw6ICdeL3VzZXJzJyxcblx0XHR2aWV3czoge1xuXHRcdFx0Jyc6IHtcblx0XHRcdFx0dGVtcGxhdGVVcmw6ICdwYWdlcy91c2Vycy91c2Vycy5saXN0Lmh0bWwnLFxuXHRcdFx0XHRjb250cm9sbGVyOiAnVXNlckxpc3RDb250cm9sbGVyJ1xuXHRcdFx0fSxcblx0XHRcdCduYXYnOiB7XG5cdFx0XHRcdHRlbXBsYXRlVXJsOiAncGFnZXMvbmF2Lmh0bWwnLFxuXHRcdFx0XHRjb250cm9sbGVyOiAnTmF2Q29udHJvbGxlcidcblx0XHRcdH0sXG5cdFx0XHQnc2lkZWJhcic6IHtcblx0XHRcdFx0dGVtcGxhdGVVcmw6ICdwYWdlcy9zaWRlYmFyLmh0bWwnLFxuXHRcdFx0XHRjb250cm9sbGVyOiAnU2lkZWJhckNvbnRyb2xsZXInXG5cdFx0XHR9XG5cdFx0fVxuXHR9KVxuXHRcdC5zdGF0ZSgnbW9kdWxlLXVzZXItZWRpdCcsIHtcblx0XHRcdHVybDogJ14vdXNlci86aWQnLFxuXHRcdFx0dmlld3M6IHtcblx0XHRcdFx0Jyc6IHtcblx0XHRcdFx0XHR0ZW1wbGF0ZVVybDogJ3BhZ2VzL3VzZXJzL3VzZXJzLmVkaXQuaHRtbCcsXG5cdFx0XHRcdFx0Y29udHJvbGxlcjogJ1VzZXJFZGl0Q29udHJvbGxlcidcblx0XHRcdFx0fSxcblx0XHRcdFx0J25hdic6IHtcblx0XHRcdFx0XHR0ZW1wbGF0ZVVybDogJ3BhZ2VzL25hdi5odG1sJyxcblx0XHRcdFx0XHRjb250cm9sbGVyOiAnTmF2Q29udHJvbGxlcidcblx0XHRcdFx0fSxcblx0XHRcdFx0J3NpZGViYXInOiB7XG5cdFx0XHRcdFx0dGVtcGxhdGVVcmw6ICdwYWdlcy9zaWRlYmFyLmh0bWwnLFxuXHRcdFx0XHRcdGNvbnRyb2xsZXI6ICdTaWRlYmFyQ29udHJvbGxlcidcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdH0pXG5cblx0LnN0YXRlKCdtb2R1bGUtdXNlci1teXByb2ZpbGUtZWRpdCcsIHtcblx0XHR1cmw6ICdeL215cHJvZmlsZS86aWQnLFxuXHRcdHZpZXdzOiB7XG5cdFx0XHQnJzoge1xuXHRcdFx0XHR0ZW1wbGF0ZVVybDogJ3BhZ2VzL3VzZXJzL3VzZXJzLm15cHJvZmlsZS5lZGl0Lmh0bWwnLFxuXHRcdFx0XHRjb250cm9sbGVyOiAnVXNlckVkaXRDb250cm9sbGVyJ1xuXHRcdFx0fSxcblx0XHRcdCduYXYnOiB7XG5cdFx0XHRcdHRlbXBsYXRlVXJsOiAncGFnZXMvbmF2Lmh0bWwnLFxuXHRcdFx0XHRjb250cm9sbGVyOiAnTmF2Q29udHJvbGxlcidcblx0XHRcdH0sXG5cdFx0XHQnc2lkZWJhcic6IHtcblx0XHRcdFx0dGVtcGxhdGVVcmw6ICdwYWdlcy9zaWRlYmFyLmh0bWwnLFxuXHRcdFx0XHRjb250cm9sbGVyOiAnU2lkZWJhckNvbnRyb2xsZXInXG5cdFx0XHR9XG5cdFx0fVxuXHR9KVxuXG5cdC5zdGF0ZSgnbW9kdWxlLXByb2plY3QtbGlzdCcsIHtcblx0XHR1cmw6ICdeL3Byb2plY3QnLFxuXHRcdHZpZXdzOiB7XG5cdFx0XHQnJzoge1xuXHRcdFx0XHR0ZW1wbGF0ZVVybDogJ3BhZ2VzL3Byb2plY3QvcHJvamVjdC5saXN0Lmh0bWwnLFxuXHRcdFx0XHRjb250cm9sbGVyOiAnUHJvamVjdExpc3RDb250cm9sbGVyJ1xuXHRcdFx0fSxcblx0XHRcdCduYXYnOiB7XG5cdFx0XHRcdHRlbXBsYXRlVXJsOiAncGFnZXMvbmF2Lmh0bWwnLFxuXHRcdFx0XHRjb250cm9sbGVyOiAnTmF2Q29udHJvbGxlcidcblx0XHRcdH0sXG5cdFx0XHQnc2lkZWJhcic6IHtcblx0XHRcdFx0dGVtcGxhdGVVcmw6ICdwYWdlcy9zaWRlYmFyLmh0bWwnLFxuXHRcdFx0XHRjb250cm9sbGVyOiAnU2lkZWJhckNvbnRyb2xsZXInXG5cdFx0XHR9XG5cdFx0fVxuXHR9KVxuXHRcdC5zdGF0ZSgnbW9kdWxlLXByb2plY3QtZWRpdCcsIHtcblx0XHRcdHVybDogJ14vcHJvamVjdC86aWQnLFxuXHRcdFx0dmlld3M6IHtcblx0XHRcdFx0Jyc6IHtcblx0XHRcdFx0XHR0ZW1wbGF0ZVVybDogJ3BhZ2VzL3Byb2plY3QvcHJvamVjdC5lZGl0Lmh0bWwnLFxuXHRcdFx0XHRcdGNvbnRyb2xsZXI6ICdQcm9qZWN0RWRpdENvbnRyb2xsZXInXG5cdFx0XHRcdH0sXG5cdFx0XHRcdCduYXYnOiB7XG5cdFx0XHRcdFx0dGVtcGxhdGVVcmw6ICdwYWdlcy9uYXYuaHRtbCcsXG5cdFx0XHRcdFx0Y29udHJvbGxlcjogJ05hdkNvbnRyb2xsZXInXG5cdFx0XHRcdH0sXG5cdFx0XHRcdCdzaWRlYmFyJzoge1xuXHRcdFx0XHRcdHRlbXBsYXRlVXJsOiAncGFnZXMvc2lkZWJhci5odG1sJyxcblx0XHRcdFx0XHRjb250cm9sbGVyOiAnU2lkZWJhckNvbnRyb2xsZXInXG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHR9KVxuXG5cdC5zdGF0ZSgnbW9kdWxlLXByb2plY3QtaG91cnMtbGlzdCcsIHtcblx0XHR1cmw6ICdeL3Byb2plY3Rob3VycycsXG5cdFx0dmlld3M6IHtcblx0XHRcdCcnOiB7XG5cdFx0XHRcdHRlbXBsYXRlVXJsOiAncGFnZXMvcHJvamVjdC9wcm9qZWN0LmhvdXJzLmxpc3QuaHRtbCcsXG5cdFx0XHRcdGNvbnRyb2xsZXI6ICdQcm9qZWN0SG91cnNMaXN0Q29udHJvbGxlcidcblx0XHRcdH0sXG5cdFx0XHQnbmF2Jzoge1xuXHRcdFx0XHR0ZW1wbGF0ZVVybDogJ3BhZ2VzL25hdi5odG1sJyxcblx0XHRcdFx0Y29udHJvbGxlcjogJ05hdkNvbnRyb2xsZXInXG5cdFx0XHR9LFxuXHRcdFx0J3NpZGViYXInOiB7XG5cdFx0XHRcdHRlbXBsYXRlVXJsOiAncGFnZXMvc2lkZWJhci5odG1sJyxcblx0XHRcdFx0Y29udHJvbGxlcjogJ1NpZGViYXJDb250cm9sbGVyJ1xuXHRcdFx0fVxuXHRcdH1cblx0fSlcblx0XHQuc3RhdGUoJ21vZHVsZS1wcm9qZWN0LWhvdXJzLWVkaXQnLCB7XG5cdFx0XHR1cmw6ICdeL3Byb2plY3Rob3Vycy86aWQnLFxuXHRcdFx0dmlld3M6IHtcblx0XHRcdFx0Jyc6IHtcblx0XHRcdFx0XHR0ZW1wbGF0ZVVybDogJ3BhZ2VzL3Byb2plY3QvcHJvamVjdC5ob3Vycy5lZGl0Lmh0bWwnLFxuXHRcdFx0XHRcdGNvbnRyb2xsZXI6ICdQcm9qZWN0SG91cnNFZGl0Q29udHJvbGxlcidcblx0XHRcdFx0fSxcblx0XHRcdFx0J25hdic6IHtcblx0XHRcdFx0XHR0ZW1wbGF0ZVVybDogJ3BhZ2VzL25hdi5odG1sJyxcblx0XHRcdFx0XHRjb250cm9sbGVyOiAnTmF2Q29udHJvbGxlcidcblx0XHRcdFx0fSxcblx0XHRcdFx0J3NpZGViYXInOiB7XG5cdFx0XHRcdFx0dGVtcGxhdGVVcmw6ICdwYWdlcy9zaWRlYmFyLmh0bWwnLFxuXHRcdFx0XHRcdGNvbnRyb2xsZXI6ICdTaWRlYmFyQ29udHJvbGxlcidcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdH0pXG5cblxuXHQuc3RhdGUoJ21vZHVsZS1zZXR0aW5ncycsIHtcblx0XHR1cmw6ICdeL3NldHRpbmdzJyxcblx0XHR2aWV3czoge1xuXHRcdFx0Jyc6IHtcblx0XHRcdFx0dGVtcGxhdGVVcmw6ICdwYWdlcy9zZXR0aW5ncy9xai5zZXR0aW5ncy5odG1sJyxcblx0XHRcdFx0Y29udHJvbGxlcjogJ1FKQmFja2VuZFNldHRpbmdzQ29udHJvbGxlcidcblx0XHRcdH0sXG5cdFx0XHQnbmF2Jzoge1xuXHRcdFx0XHR0ZW1wbGF0ZVVybDogJ3BhZ2VzL25hdi5odG1sJyxcblx0XHRcdFx0Y29udHJvbGxlcjogJ05hdkNvbnRyb2xsZXInXG5cdFx0XHR9LFxuXHRcdFx0J3NpZGViYXInOiB7XG5cdFx0XHRcdHRlbXBsYXRlVXJsOiAncGFnZXMvc2lkZWJhci5odG1sJyxcblx0XHRcdFx0Y29udHJvbGxlcjogJ1NpZGViYXJDb250cm9sbGVyJ1xuXHRcdFx0fVxuXHRcdH1cblx0fSlcblxuXG5cdC5zdGF0ZSgnbW9kdWxlLXZpcHN0ZXItc2V0dGluZ3MnLCB7XG5cdFx0dXJsOiAnXi92aXBzdGVyL3NldHRpbmdzJyxcblx0XHR2aWV3czoge1xuXHRcdFx0Jyc6IHtcblx0XHRcdFx0dGVtcGxhdGVVcmw6ICdwYWdlcy92aXBzdGVyL3ZpcHN0ZXIuc2V0dGluZ3MuaHRtbCcsXG5cdFx0XHRcdGNvbnRyb2xsZXI6ICdWaXBzdGVyQ29uZmlnQ29udHJvbGxlcidcblx0XHRcdH0sXG5cdFx0XHQnbmF2Jzoge1xuXHRcdFx0XHR0ZW1wbGF0ZVVybDogJ3BhZ2VzL25hdi5odG1sJyxcblx0XHRcdFx0Y29udHJvbGxlcjogJ05hdkNvbnRyb2xsZXInXG5cdFx0XHR9LFxuXHRcdFx0J3NpZGViYXInOiB7XG5cdFx0XHRcdHRlbXBsYXRlVXJsOiAncGFnZXMvc2lkZWJhci5odG1sJyxcblx0XHRcdFx0Y29udHJvbGxlcjogJ1NpZGViYXJDb250cm9sbGVyJ1xuXHRcdFx0fVxuXHRcdH1cblx0fSlcblxuXHQuc3RhdGUoJ21vZHVsZS1jaGF0Jywge1xuXHRcdHVybDogJ14vY2hhdCcsXG5cdFx0dmlld3M6IHtcblx0XHRcdCcnOiB7XG5cdFx0XHRcdHRlbXBsYXRlVXJsOiAncGFnZXMvY2hhdC9jaGF0Lm1haW4uaHRtbCcsXG5cdFx0XHRcdGNvbnRyb2xsZXI6ICdDaGF0Q29udHJvbGxlcidcblx0XHRcdH0sXG5cdFx0XHQnbmF2Jzoge1xuXHRcdFx0XHR0ZW1wbGF0ZVVybDogJ3BhZ2VzL25hdi5odG1sJyxcblx0XHRcdFx0Y29udHJvbGxlcjogJ05hdkNvbnRyb2xsZXInXG5cdFx0XHR9LFxuXHRcdFx0J3NpZGViYXInOiB7XG5cdFx0XHRcdHRlbXBsYXRlVXJsOiAncGFnZXMvc2lkZWJhci5odG1sJyxcblx0XHRcdFx0Y29udHJvbGxlcjogJ1NpZGViYXJDb250cm9sbGVyJ1xuXHRcdFx0fVxuXHRcdH1cblx0fSlcblxuXG5cblx0O1xufSk7XG59KS5jYWxsKHRoaXMscmVxdWlyZShcIis3WkpwMFwiKSx0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30scmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIsYXJndW1lbnRzWzNdLGFyZ3VtZW50c1s0XSxhcmd1bWVudHNbNV0sYXJndW1lbnRzWzZdLFwiLy4uL2NvbmZpZy9yb3V0ZXMuanNcIixcIi8uLi9jb25maWdcIikiLCIoZnVuY3Rpb24gKHByb2Nlc3MsZ2xvYmFsLEJ1ZmZlcixfX2FyZ3VtZW50MCxfX2FyZ3VtZW50MSxfX2FyZ3VtZW50MixfX2FyZ3VtZW50MyxfX2ZpbGVuYW1lLF9fZGlybmFtZSl7XG5tb2R1bGUuZXhwb3J0cyA9IGFuZ3VsYXIubW9kdWxlKCdhcHAuY29udHJvbGxlcnMnLCBbXSk7XG5yZXF1aXJlKCcuL2FwcEN0cmwuanMnKTtcbnJlcXVpcmUoJy4vY2hhdEN0cmwuanMnKTtcbnJlcXVpcmUoJy4vaG9tZUN0cmwuanMnKTtcbnJlcXVpcmUoJy4vbG9naW5DdHJsLmpzJyk7XG5yZXF1aXJlKCcuL21vZC5tZW51Q3RybC5qcycpO1xucmVxdWlyZSgnLi9tb2QucHJvZmlsZUN0cmwuanMnKTtcbnJlcXVpcmUoJy4vbW9kLnByb2plY3Rob3Vyc0N0cmwuanMnKTtcbnJlcXVpcmUoJy4vbW9kLnByb2plY3RzQ3RybC5qcycpO1xucmVxdWlyZSgnLi9tb2QudXNlcmdyb3VwQ3RybC5qcycpO1xucmVxdWlyZSgnLi9tb2QudXNlcnNDdHJsLmpzJyk7XG5yZXF1aXJlKCcuL25hdkN0cmwuanMnKTtcbnJlcXVpcmUoJy4vc2V0dGluZ3NDdHJsLmpzJyk7XG5yZXF1aXJlKCcuL3NpZGViYXJDdHJsLmpzJyk7XG5yZXF1aXJlKCcuL3ZwLmNvbmZpZ0N0cmwuanMnKTtcbn0pLmNhbGwodGhpcyxyZXF1aXJlKFwiKzdaSnAwXCIpLHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvLi4vY29udHJvbGxlcnMvX21vZHVsZV9pbml0LmpzXCIsXCIvLi4vY29udHJvbGxlcnNcIikiLCIoZnVuY3Rpb24gKHByb2Nlc3MsZ2xvYmFsLEJ1ZmZlcixfX2FyZ3VtZW50MCxfX2FyZ3VtZW50MSxfX2FyZ3VtZW50MixfX2FyZ3VtZW50MyxfX2ZpbGVuYW1lLF9fZGlybmFtZSl7XG52YXIgbW9kdWxlID0gcmVxdWlyZSgnLi9fbW9kdWxlX2luaXQuanMnKTtcbm1vZHVsZS5jb250cm9sbGVyKCdBcHBDb250cm9sbGVyJywgZnVuY3Rpb24oXG5cdCRRSkxvZ2dlciwgJFFKSGVscGVyRnVuY3Rpb25zLCAkc2NvcGUsICRyb290U2NvcGUsICRRSkxvZ2luTW9kdWxlLCAkUUpBcGksICR0aW1lb3V0LCAkc3RhdGUsICRRSkxvZ2luTW9kdWxlXG4pIHtcblx0JFFKTG9nZ2VyLmxvZyhcIkFwcENvbnRyb2xsZXIgLT4gaW5pdGlhbGl6ZWRcIik7XG5cdC8vJFFKSGVscGVyRnVuY3Rpb25zLmNoZWNrQVBJQW5kR29Ub0FwaUVycm9yU3RhdGVJZlRoZXJlSXNBUHJvYmxlbSgpO1xuXHQkUUpIZWxwZXJGdW5jdGlvbnMuY2hlY2tUb2tlbkV4cGlyYXRpb25BbmRHb1RvTG9naW5TdGF0ZUlmSGFzRXhwaXJlZCgpO1xufSk7XG59KS5jYWxsKHRoaXMscmVxdWlyZShcIis3WkpwMFwiKSx0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30scmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIsYXJndW1lbnRzWzNdLGFyZ3VtZW50c1s0XSxhcmd1bWVudHNbNV0sYXJndW1lbnRzWzZdLFwiLy4uL2NvbnRyb2xsZXJzL2FwcEN0cmwuanNcIixcIi8uLi9jb250cm9sbGVyc1wiKSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbnZhciBtb2R1bGUgPSByZXF1aXJlKCcuL19tb2R1bGVfaW5pdC5qcycpO1xubW9kdWxlLmNvbnRyb2xsZXIoJ0NoYXRDb250cm9sbGVyJywgZnVuY3Rpb24oXG5cdCRRSkNDb21ib2JveCwgJFFKQ1NlbGVjdGtleSwgJFFKQ0xpc3R2aWV3LCAkUUpDRmlsdGVyLCAkUUpMb2dnZXIsICRRSkhlbHBlckZ1bmN0aW9ucywgJHNjb3BlLCAkcm9vdFNjb3BlLCAkUUpMb2dpbk1vZHVsZSwgJFFKQXBpLCAkdGltZW91dCwgJHN0YXRlLCAkUUpMb2dpbk1vZHVsZVxuKSB7XG5cdCRRSkxvZ2dlci5sb2coXCJDaGF0Q29udHJvbGxlciAtPiBpbml0aWFsaXplZFwiKTtcblxuXG5cdCRzY29wZS5icmVhZGNydW1iID0ge1xuXHRcdG5hbWU6ICdDaGF0Jyxcblx0XHRsaXN0OiBbXG5cdFx0XHQvL3tuYW1lOidOb25lMicsc3RhdGU6JycsZmE6J2ZhLWRhc2hib2FyZCd9XG5cdFx0XSxcblx0XHRhY3RpdmU6IFwiQ2hhdFwiXG5cdH07XG5cblxuXHQkc2NvcGUuaW5wdXQgPSBcIlwiO1xuXHQkc2NvcGUuaXRlbXMgPSBbe1xuXHRcdHNlbmRlcjogXCJQZXBlXCIsXG5cdFx0bWVzc2FnZTogXCJCbGFibGFcIlxuXHR9LCB7XG5cdFx0c2VuZGVyOiBcIlBlcGUgMlwiLFxuXHRcdG1lc3NhZ2U6IFwiQmxhYmxhXCJcblx0fV07XG5cblxuXG5cdC8qXG5cdFx0dmFyIG9iaiA9IEpTT04ucGFyc2UoZS5kYXRhKTtcblx0XHRjb25zb2xlLmluZm8ob2JqKTtcblx0XHQkdGltZW91dChmdW5jdGlvbigpe1xuXHRcdFx0JHNjb3BlLiRhcHBseShmdW5jdGlvbigpe1xuXHRcdFx0XHQkc2NvcGUuaXRlbXMucHVzaChvYmopO1xuXHRcdFx0fSk7XG5cdFx0fSk7XG5cdCovXG5cblxuXHQkc2NvcGUuZW50ZXIgPSBmdW5jdGlvbigpIHtcblx0XHR2YXIgbmV3SXRlbSA9IHtcblx0XHRcdGxvZ2lubmFtZTogJHJvb3RTY29wZS5zZXNzaW9uLmxvZ2lubmFtZSxcblx0XHRcdG1lc3NhZ2U6ICRzY29wZS5pbnB1dFxuXHRcdH07XG5cdFx0JHNjb3BlLml0ZW1zLnVuc2hpZnQobmV3SXRlbSk7XG5cdFx0JHNjb3BlLmlucHV0ID0gXCJcIjtcblx0XHQvL1xuXHRcdCRRSkFwaS5nZXRDb250cm9sbGVyKCdjaGF0JykucG9zdCh7XG5cdFx0XHRhY3Rpb246ICdzYXZlJ1xuXHRcdH0sIHtcblx0XHRcdG1lc3NhZ2U6IG5ld0l0ZW0ubWVzc2FnZSxcblx0XHRcdF9jaGF0X2lkOiAxXG5cdFx0fSwgZnVuY3Rpb24ocmVzKSB7XG5cdFx0XHQkUUpMb2dnZXIubG9nKFwiQ2hhdENvbnRyb2xsZXIgLT4gUE9TVCBjaGF0IHNhdmUgLT4gc3VjY2Vzc1wiKTtcblx0XHRcdHVwZGF0ZSgpO1xuXHRcdH0pO1xuXHR9O1xuXG5cblxuXHRmdW5jdGlvbiB1cGRhdGUoKSB7XG5cdFx0JFFKQXBpLmdldENvbnRyb2xsZXIoJ2NoYXQnKS5nZXQoe1xuXHRcdFx0YWN0aW9uOiAnbGlzdCdcblx0XHR9LCBmdW5jdGlvbihyZXMpIHtcblx0XHRcdCRRSkxvZ2dlci5sb2coXCJDaGF0Q29udHJvbGxlciAtPiBHRVQgY2hhdCBsaXN0IC0+IHN1Y2Nlc3NcIik7XG5cdFx0XHQkc2NvcGUuaXRlbXMgPSBfLnNvcnRCeShyZXMuaXRlbXMsIGZ1bmN0aW9uKGl0ZW0pIHtcblx0XHRcdFx0cmV0dXJuIGl0ZW0uX2lkICogLTE7XG5cdFx0XHR9KTtcblx0XHRcdGNvbnNvbGUuaW5mbyhyZXMuaXRlbXMpO1xuXHRcdH0pO1xuXHR9XG5cdHVwZGF0ZSgpO1xuXG5cdHZhciBteVZhciA9IHNldEludGVydmFsKHVwZGF0ZSwgNTAwMCk7XG5cblx0JHJvb3RTY29wZS4kb24oJyRzdGF0ZUNoYW5nZVN0YXJ0Jyxcblx0XHRmdW5jdGlvbihldmVudCwgdG9TdGF0ZSwgdG9QYXJhbXMsIGZyb21TdGF0ZSwgZnJvbVBhcmFtcykge1xuXG5cdFx0XHRpZiAoZnJvbVN0YXRlLm5hbWUgPT09IFwibW9kdWxlLWNoYXRcIikge1xuXHRcdFx0XHRjbGVhckludGVydmFsKG15VmFyKTtcblx0XHRcdH1cblxuXHRcdH0pO1xuXG59KVxuXG59KS5jYWxsKHRoaXMscmVxdWlyZShcIis3WkpwMFwiKSx0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30scmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIsYXJndW1lbnRzWzNdLGFyZ3VtZW50c1s0XSxhcmd1bWVudHNbNV0sYXJndW1lbnRzWzZdLFwiLy4uL2NvbnRyb2xsZXJzL2NoYXRDdHJsLmpzXCIsXCIvLi4vY29udHJvbGxlcnNcIikiLCIoZnVuY3Rpb24gKHByb2Nlc3MsZ2xvYmFsLEJ1ZmZlcixfX2FyZ3VtZW50MCxfX2FyZ3VtZW50MSxfX2FyZ3VtZW50MixfX2FyZ3VtZW50MyxfX2ZpbGVuYW1lLF9fZGlybmFtZSl7XG52YXIgbW9kdWxlID0gcmVxdWlyZSgnLi9fbW9kdWxlX2luaXQuanMnKTtcbm1vZHVsZS5jb250cm9sbGVyKCdIb21lQ29udHJvbGxlcicsIGZ1bmN0aW9uKFxuXHQkUUpBdXRoLCAkUUpDQ29tYm9ib3gsICRRSkxvZ2dlciwgJHNjb3BlLCAkcm9vdFNjb3BlLCAkUUpMb2dpbk1vZHVsZSwgJFFKTG9jYWxTZXNzaW9uLCAkUUpDb25maWcsICRRSkFwaSkge1xuXHQkUUpMb2dnZXIubG9nKFwiSG9tZUNvbnRyb2xsZXIgLT4gaW5pdGlhbGl6ZWRcIik7XG5cblx0JHNjb3BlLmJyZWFkY3J1bWIgPSB7XG5cdFx0bmFtZTogJ0Rhc2hib2FyZCcsXG5cdFx0bGlzdDogW1xuXHRcdFx0Ly97bmFtZTpcIk5vbmUxXCIsc3RhdGU6J21vZHVsZS1wcm9qZWN0LWxpc3QnLGZhOidmYS1kYXNoYm9hcmQnfSxcblx0XHRcdC8ve25hbWU6J05vbmUyJyxzdGF0ZTonJyxmYTonZmEtZGFzaGJvYXJkJ31cblx0XHRdLFxuXHRcdGFjdGl2ZTogXCJEYXNoYm9hcmRcIlxuXHR9O1xuXG5cbn0pO1xufSkuY2FsbCh0aGlzLHJlcXVpcmUoXCIrN1pKcDBcIiksdHlwZW9mIHNlbGYgIT09IFwidW5kZWZpbmVkXCIgPyBzZWxmIDogdHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiA/IHdpbmRvdyA6IHt9LHJlcXVpcmUoXCJidWZmZXJcIikuQnVmZmVyLGFyZ3VtZW50c1szXSxhcmd1bWVudHNbNF0sYXJndW1lbnRzWzVdLGFyZ3VtZW50c1s2XSxcIi8uLi9jb250cm9sbGVycy9ob21lQ3RybC5qc1wiLFwiLy4uL2NvbnRyb2xsZXJzXCIpIiwiKGZ1bmN0aW9uIChwcm9jZXNzLGdsb2JhbCxCdWZmZXIsX19hcmd1bWVudDAsX19hcmd1bWVudDEsX19hcmd1bWVudDIsX19hcmd1bWVudDMsX19maWxlbmFtZSxfX2Rpcm5hbWUpe1xudmFyIG1vZHVsZSA9IHJlcXVpcmUoJy4vX21vZHVsZV9pbml0LmpzJyk7XG5tb2R1bGUuY29udHJvbGxlcignTG9naW5Db250cm9sbGVyJywgZnVuY3Rpb24oXG4gICAgJFFKTG9nZ2VyLFxuICAgICRzY29wZSwgJHJvb3RTY29wZSwgJFFKTG9naW5Nb2R1bGUsICR0aW1lb3V0LCAkUUpIZWxwZXJGdW5jdGlvbnMpIHtcbiAgICAkUUpMb2dnZXIubG9nKCdMb2dpbkNvbnRyb2xsZXInKTtcblxuICAgICRzY29wZS5sb2dpbm5hbWVSZXF1aXJlZCA9IGZhbHNlO1xuICAgICRzY29wZS5wYXNzd29yZFJlcXVpcmVkID0gZmFsc2U7XG5cbiAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgICAkcm9vdFNjb3BlLmVycm9yID0ge1xuICAgICAgICAgICAgbWVzc2FnZTogXCJcIlxuICAgICAgICB9O1xuICAgIH0sIDQwMDApO1xuXG5cbiAgICAkc2NvcGUuY2xhc3NGb3JQYXNzd29yZCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gJ2Zvcm0tZ3JvdXAgJyArICgkc2NvcGUucGFzc3dvcmRSZXF1aXJlZCA/ICdoYXMtZXJyb3InIDogJycpO1xuICAgIH07XG5cbiAgICAkc2NvcGUuaW52YWxpZENyZWRlbnRpYWxzID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIGNvbnNvbGUuaW5mbyhcIltRSmFydmlzQXBwTG9naW5Db250cm9sbGVyXS0+W0ludmFsaWRDcmVkZW50aWFsc11cIik7XG4gICAgICAgICRzY29wZS5zaG93RXJyb3IoXCJDcmVkZW5jaWFsZXMgaW52YWxpZGFzXCIpO1xuICAgIH07XG5cbiAgICAkc2NvcGUuc2hvd0Vycm9yID0gZnVuY3Rpb24oZXJyb3JNZXNzYWdlKSB7XG4gICAgICAgICRyb290U2NvcGUuZXJyb3IgPSB7XG4gICAgICAgICAgICBtZXNzYWdlOiBlcnJvck1lc3NhZ2VcbiAgICAgICAgfTtcbiAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICRyb290U2NvcGUubWVzc2FnZSA9ICcnO1xuICAgICAgICB9LCA1MDAwKTtcbiAgICB9O1xuXG4gICAgJHNjb3BlLnZhbGlkYXRlRmllbGRzID0gZnVuY3Rpb24oc3VjY2Vzcykge1xuICAgICAgICBpZiAoXy5pc1VuZGVmaW5lZCgkc2NvcGUubG9naW5uYW1lKSB8fCAkc2NvcGUubG9naW5uYW1lID09IFwiXCIpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuaW5mbyhcIltdLT5bbG9naW5uYW1lIHJlcXVpcmVkXVwiKTtcbiAgICAgICAgICAgICRzY29wZS5zaG93RXJyb3IoXCJVc3VhcmlvIHJlcXVlcmlkb1wiKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGlmIChfLmlzVW5kZWZpbmVkKCRzY29wZS5wYXNzd29yZCkgfHwgJHNjb3BlLnBhc3N3b3JkID09IFwiXCIpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmluZm8oXCJbXS0+W3Bhc3N3b3JkIHJlcXVpcmVkXVwiKTtcbiAgICAgICAgICAgICAgICAkc2NvcGUuc2hvd0Vycm9yKFwiUGFzc3dvcmQgcmVxdWVyaWRhXCIpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBzdWNjZXNzKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgJHNjb3BlLnN1Ym1pdCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAkc2NvcGUudmFsaWRhdGVGaWVsZHMoZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAkUUpMb2dpbk1vZHVsZS5sb2dpbigkc2NvcGUubG9naW5uYW1lLCAkc2NvcGUucGFzc3dvcmQsIGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgICRRSkhlbHBlckZ1bmN0aW9ucy5jaGFuZ2VTdGF0ZSgnaG9tZScpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH07XG59KTtcbn0pLmNhbGwodGhpcyxyZXF1aXJlKFwiKzdaSnAwXCIpLHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvLi4vY29udHJvbGxlcnMvbG9naW5DdHJsLmpzXCIsXCIvLi4vY29udHJvbGxlcnNcIikiLCIoZnVuY3Rpb24gKHByb2Nlc3MsZ2xvYmFsLEJ1ZmZlcixfX2FyZ3VtZW50MCxfX2FyZ3VtZW50MSxfX2FyZ3VtZW50MixfX2FyZ3VtZW50MyxfX2ZpbGVuYW1lLF9fZGlybmFtZSl7XG52YXIgbW9kdWxlID0gcmVxdWlyZSgnLi9fbW9kdWxlX2luaXQuanMnKTtcbm1vZHVsZS5jb250cm9sbGVyKCdNZW51TGlzdENvbnRyb2xsZXInLCBmdW5jdGlvbihcbiAgICAkUUpDQ29tYm9ib3gsICRRSkNTZWxlY3RrZXksICRRSkNMaXN0dmlldywgJFFKQ0ZpbHRlciwgJFFKTG9nZ2VyLCAkUUpIZWxwZXJGdW5jdGlvbnMsICRzY29wZSwgJHJvb3RTY29wZSwgJFFKTG9naW5Nb2R1bGUsICRRSkFwaSwgJHRpbWVvdXQsICRzdGF0ZSwgJFFKTG9naW5Nb2R1bGVcbikge1xuICAgICRRSkxvZ2dlci5sb2coXCJNZW51TGlzdENvbnRyb2xsZXIgLT4gaW5pdGlhbGl6ZWRcIik7XG5cblxuXG4gICAgJHNjb3BlLmJyZWFkY3J1bWIgPSB7XG4gICAgICAgIG5hbWU6ICdNZW51IEVkaXRvcicsXG4gICAgICAgIGxpc3Q6IFtcbiAgICAgICAgICAgIC8ve25hbWU6XCJOb25lMVwiLHN0YXRlOidtb2R1bGUtcHJvamVjdC1saXN0JyxmYTonZmEtZGFzaGJvYXJkJ30sXG4gICAgICAgICAgICAvL3tuYW1lOidOb25lMicsc3RhdGU6JycsZmE6J2ZhLWRhc2hib2FyZCd9XG4gICAgICAgIF0sXG4gICAgICAgIGFjdGl2ZTogXCJNZW51IEVkaXRvclwiXG4gICAgfTtcblxuICAgICRzY29wZS5tZW51QXJyID0gW107IC8vaG9sZHMgaXRlbXMgZnJvbSBkYlxuICAgICRzY29wZS5tZW51RGF0YSA9IG51bGw7IC8vaG9sZHMgaXRlbXMgZGl2aWRlZCBwZXIgcGFnZVxuXG4gICAgLy9maWx0ZXJcbiAgICAkUUpDRmlsdGVyLmNyZWF0ZSh7XG4gICAgICAgIG5hbWU6ICdtZW51RmlsdGVyJyxcbiAgICAgICAgZmllbGRzOiBbe1xuICAgICAgICAgICAgbmFtZTogJ2Rlc2NyaXB0aW9uJyxcbiAgICAgICAgICAgIGFycmF5TmFtZTogJ21lbnVBcnInLFxuICAgICAgICAgICAgYmluZFRvOiBbJ2Rlc2NyaXB0aW9uJ11cbiAgICAgICAgfSwge1xuICAgICAgICAgICAgbmFtZTogJ19wcm9maWxlX2lkJyxcbiAgICAgICAgICAgIGFycmF5TmFtZTogJ21lbnVBcnInLFxuICAgICAgICAgICAgYmluZFRvOiBbJ19wcm9maWxlX2lkJ11cbiAgICAgICAgfSwge1xuICAgICAgICAgICAgbmFtZTogJ19ncm91cF9pZCcsXG4gICAgICAgICAgICBhcnJheU5hbWU6ICdtZW51QXJyJyxcbiAgICAgICAgICAgIGJpbmRUbzogWydfZ3JvdXBfaWQnXVxuICAgICAgICB9XVxuICAgIH0sICRzY29wZSk7XG5cbiAgICBmdW5jdGlvbiBsb2FkQ29udHJvbHMoKSB7XG4gICAgICAgIC8vY29tYm9ib3hcbiAgICAgICAgJFFKQ0NvbWJvYm94LmNyZWF0ZSh7XG4gICAgICAgICAgICBuYW1lOiAncHJvZmlsZUNCTycsXG4gICAgICAgICAgICBsYWJlbDogXCJQcm9maWxlXCIsXG4gICAgICAgICAgICBjb2RlOiAtMSxcbiAgICAgICAgICAgIGNvZGVfY29weXRvOiAnbWVudUZpbHRlci5maWVsZHMuX3Byb2ZpbGVfaWQnLFxuICAgICAgICAgICAgYXBpOiB7XG4gICAgICAgICAgICAgICAgY29udHJvbGxlcjogJ3Byb2ZpbGUnLFxuICAgICAgICAgICAgICAgIHBhcmFtczoge1xuICAgICAgICAgICAgICAgICAgICBhY3Rpb246ICdjb21ib2JveF9hbGwnXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgfSwgJHNjb3BlKTtcbiAgICAgICAgLy9jb21ib2JveFxuICAgICAgICAkUUpDQ29tYm9ib3guY3JlYXRlKHtcbiAgICAgICAgICAgIG5hbWU6ICdncm91cENCTycsXG4gICAgICAgICAgICBsYWJlbDogXCJJbXBsZW1lbnRhdGlvbiBncm91cFwiLFxuICAgICAgICAgICAgY29kZTogLTEsXG4gICAgICAgICAgICBjb2RlX2NvcHl0bzogJ21lbnVGaWx0ZXIuZmllbGRzLl9ncm91cF9pZCcsXG4gICAgICAgICAgICBhcGk6IHtcbiAgICAgICAgICAgICAgICBjb250cm9sbGVyOiAnZ3JvdXAnLFxuICAgICAgICAgICAgICAgIHBhcmFtczoge1xuICAgICAgICAgICAgICAgICAgICBhY3Rpb246ICdjb21ib2JveF9hbGwnXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgfSwgJHNjb3BlKTtcbiAgICAgICAgLy9saXN0dmlld1xuICAgICAgICAkUUpDTGlzdHZpZXcuY3JlYXRlKHtcbiAgICAgICAgICAgIG5hbWU6ICdtZW51TFZXJyxcbiAgICAgICAgICAgIGRhdGFBcnJheTogJ21lbnVBcnInLFxuICAgICAgICAgICAgcGFnZWREYXRhQXJyYXk6ICdtZW51RGF0YScsXG4gICAgICAgICAgICBhcGk6IHtcbiAgICAgICAgICAgICAgICBjb250cm9sbGVyOiAnbWVudScsXG4gICAgICAgICAgICAgICAgcGFyYW1zOiB7XG4gICAgICAgICAgICAgICAgICAgIGFjdGlvbjogJ2NvbWJvYm94X2FsbCdcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgY29sdW1uczogW3tcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogJ2Rlc2NyaXB0aW9uJyxcbiAgICAgICAgICAgICAgICAgICAgbGFiZWw6ICdEZXNjcmlwdGlvbidcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgLy97bmFtZTonZmlyc3RfbmFtZScsbGFiZWw6J0ZpcnN0IG5hbWUnfSxcbiAgICAgICAgICAgICAgICAvL3tuYW1lOidfcHJvZmlsZV9pZCcsbGFiZWw6J0xhc3QgbmFtZSd9XG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgaXRlbUNsaWNrOiBmdW5jdGlvbihpdGVtKSB7XG4gICAgICAgICAgICAgICAgJFFKSGVscGVyRnVuY3Rpb25zLmNoYW5nZVN0YXRlKCdtb2R1bGUtbWVudS1lZGl0Jywge1xuICAgICAgICAgICAgICAgICAgICBpZDogaXRlbS5faWRcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSwgJHNjb3BlKTtcbiAgICB9XG5cblxuICAgIC8vTG9hZCBjb250cm9scyB3aGVuIGN1cnJlbnQgaXRlbSBpdHMgYXZhbGlhYmxlLlxuICAgIHZhciBjb250cm9sc0xvYWRlZCA9IGZhbHNlO1xuICAgICRyb290U2NvcGUuJG9uKCdjdXJyZW50VXNlci5jaGFuZ2UnLCBmdW5jdGlvbigpIHtcbiAgICAgICAgbG9hZENvbnRyb2xzKCk7XG4gICAgICAgIGNvbnRyb2xzTG9hZGVkID0gdHJ1ZTtcbiAgICB9KTtcbiAgICBpZiAoIWNvbnRyb2xzTG9hZGVkICYmICFfLmlzVW5kZWZpbmVkKCRyb290U2NvcGUuY3VycmVudFVzZXIpKSB7XG4gICAgICAgIGxvYWRDb250cm9scygpO1xuICAgICAgICBjb250cm9sc0xvYWRlZCA9IHRydWU7XG4gICAgfVxuICAgIC8vZGVmYXVsdHNcbiAgICAkdGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgJHNjb3BlLm1lbnVGaWx0ZXIuZmlsdGVyKCk7XG4gICAgfSwgMjAwMCk7XG59KVxuXG5cblxubW9kdWxlLmNvbnRyb2xsZXIoJ01lbnVFZGl0Q29udHJvbGxlcicsIGZ1bmN0aW9uKFxuICAgICRRSkNDb21ib2JveCwgJFFKTG9nZ2VyLCAkUUpIZWxwZXJGdW5jdGlvbnMsICRzY29wZSwgJHJvb3RTY29wZSwgJFFKTG9naW5Nb2R1bGUsICRRSkFwaSwgJHRpbWVvdXQsICRzdGF0ZSwgJFFKTG9naW5Nb2R1bGVcbikge1xuICAgICRRSkxvZ2dlci5sb2coXCJNZW51RWRpdENvbnRyb2xsZXIgLT4gaW5pdGlhbGl6ZWRcIik7XG5cbiAgICB2YXIgX21lbnVfaWQgPSAkc3RhdGUucGFyYW1zLmlkO1xuXG4gICAgJHNjb3BlLmNydWQgPSB7XG4gICAgICAgIGVycm9yczogW11cbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzaG93RXJyb3IoZXJyb3IpIHtcbiAgICAgICAgJHNjb3BlLmNydWQuZXJyb3JzLnB1c2goZXJyb3IpO1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBmb3JtSGFzRXJyb3JzKCkge1xuICAgICAgICAkc2NvcGUuY3J1ZC5lcnJvcnMgPSBbXTtcbiAgICAgICAgdmFyIGhhc0Vycm9ycyA9IGZhbHNlO1xuICAgICAgICBpZiAoXy5pc1VuZGVmaW5lZCgkc2NvcGUuaXRlbS5kZXNjcmlwdGlvbikgfHwgJHNjb3BlLml0ZW0uZGVzY3JpcHRpb24gPT0gJycpIHtcbiAgICAgICAgICAgIGhhc0Vycm9ycyA9IHNob3dFcnJvcignRGVzY3JpcHRpb24gcmVxdWlyZWQnKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoXy5pc1VuZGVmaW5lZCgkc2NvcGUuaXRlbS5fZ3JvdXBfaWQpIHx8ICRzY29wZS5pdGVtLl9ncm91cF9pZCA9PSAnJykge1xuICAgICAgICAgICAgaGFzRXJyb3JzID0gc2hvd0Vycm9yKCdHcm91cCByZXF1aXJlZCcpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChfLmlzVW5kZWZpbmVkKCRzY29wZS5pdGVtLl9wcm9maWxlX2lkKSB8fCAkc2NvcGUuaXRlbS5fcHJvZmlsZV9pZCA9PSAnJykge1xuICAgICAgICAgICAgaGFzRXJyb3JzID0gc2hvd0Vycm9yKCdQcm9maWxlIHJlcXVpcmVkJyk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGhhc0Vycm9ycztcbiAgICB9XG5cbiAgICAkc2NvcGUuc2F2ZSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICBpZiAoIWZvcm1IYXNFcnJvcnMoKSkge1xuICAgICAgICAgICAgJFFKQXBpLmdldENvbnRyb2xsZXIoJ21lbnUnKS5wb3N0KHtcbiAgICAgICAgICAgICAgICBhY3Rpb246ICdzYXZlJ1xuICAgICAgICAgICAgfSwgJHNjb3BlLml0ZW0sIGZ1bmN0aW9uKHJlcykge1xuICAgICAgICAgICAgICAgICRRSkxvZ2dlci5sb2coXCJNZW51RWRpdENvbnRyb2xsZXIgLT4gYXBpIHBvc3QgLT4gbWVudSBzYXZlIC0+IHN1Y2Nlc3NcIik7XG4gICAgICAgICAgICAgICAgLy9cbiAgICAgICAgICAgICAgICBzaG93RXJyb3IoJ0NhbWJpb3MgZ3VhcmRhZG9zJyk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfTtcbiAgICB9O1xuICAgICRzY29wZS5jYW5jZWwgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgJFFKSGVscGVyRnVuY3Rpb25zLmNoYW5nZVN0YXRlKCdtb2R1bGUtbWVudS1saXN0Jyk7XG4gICAgfTtcblxuXG4gICAgZnVuY3Rpb24gbG9hZENvbnRyb2xzKCkge1xuICAgICAgICAvL2NvbWJvYm94XG4gICAgICAgICRRSkNDb21ib2JveC5jcmVhdGUoe1xuICAgICAgICAgICAgbmFtZTogJ2dyb3VwQ0JPJyxcbiAgICAgICAgICAgIGxhYmVsOiBcIkltcGxlbWVudGF0aW9uIGdyb3VwXCIsXG4gICAgICAgICAgICBjb2RlOiAkc2NvcGUuaXRlbS5fZ3JvdXBfaWQsXG4gICAgICAgICAgICBjb2RlX2NvcHl0bzogJ2l0ZW0uX2dyb3VwX2lkJyxcbiAgICAgICAgICAgIGFwaToge1xuICAgICAgICAgICAgICAgIGNvbnRyb2xsZXI6ICdncm91cCcsXG4gICAgICAgICAgICAgICAgcGFyYW1zOiB7XG4gICAgICAgICAgICAgICAgICAgIGFjdGlvbjogJ2NvbWJvYm94X2FsbCdcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICB9LCAkc2NvcGUpO1xuICAgICAgICAvL2NvbWJvYm94XG4gICAgICAgICRRSkNDb21ib2JveC5jcmVhdGUoe1xuICAgICAgICAgICAgbmFtZTogJ3Byb2ZpbGVDQk8nLFxuICAgICAgICAgICAgbGFiZWw6IFwiUHJvZmlsZVwiLFxuICAgICAgICAgICAgY29kZTogJHNjb3BlLml0ZW0uX3Byb2ZpbGVfaWQsXG4gICAgICAgICAgICBjb2RlX2NvcHl0bzogJ2l0ZW0uX3Byb2ZpbGVfaWQnLFxuICAgICAgICAgICAgYXBpOiB7XG4gICAgICAgICAgICAgICAgY29udHJvbGxlcjogJ3Byb2ZpbGUnLFxuICAgICAgICAgICAgICAgIHBhcmFtczoge1xuICAgICAgICAgICAgICAgICAgICBhY3Rpb246ICdjb21ib2JveF9hbGwnXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgfSwgJHNjb3BlKTtcbiAgICB9XG5cblxuXG4gICAgLy9HRVQgU0lOR0xFIFVTRVJcbiAgICAkUUpBcGkuZ2V0Q29udHJvbGxlcignbWVudScpLmdldCh7XG4gICAgICAgIGFjdGlvbjogJ3NpbmdsZScsXG4gICAgICAgIGlkOiBfbWVudV9pZFxuICAgIH0sIGZ1bmN0aW9uKHJlcykge1xuICAgICAgICAkUUpMb2dnZXIubG9nKFwiTWVudUVkaXRDb250cm9sbGVyIC0+IGFwaSBnZXQgLT4gbWVudSBzaW5nbGUgLT4gc3VjY2Vzc1wiKTtcbiAgICAgICAgJHNjb3BlLml0ZW0gPSByZXMuaXRlbXNbMF0gfHwgbnVsbDtcbiAgICAgICAgbG9hZENvbnRyb2xzKCk7XG4gICAgfSk7XG5cblxufSk7XG5cblxuO1xufSkuY2FsbCh0aGlzLHJlcXVpcmUoXCIrN1pKcDBcIiksdHlwZW9mIHNlbGYgIT09IFwidW5kZWZpbmVkXCIgPyBzZWxmIDogdHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiA/IHdpbmRvdyA6IHt9LHJlcXVpcmUoXCJidWZmZXJcIikuQnVmZmVyLGFyZ3VtZW50c1szXSxhcmd1bWVudHNbNF0sYXJndW1lbnRzWzVdLGFyZ3VtZW50c1s2XSxcIi8uLi9jb250cm9sbGVycy9tb2QubWVudUN0cmwuanNcIixcIi8uLi9jb250cm9sbGVyc1wiKSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbnZhciBtb2R1bGUgPSByZXF1aXJlKCcuL19tb2R1bGVfaW5pdC5qcycpO1xubW9kdWxlLmNvbnRyb2xsZXIoJ1Byb2ZpbGVMaXN0Q29udHJvbGxlcicsIGZ1bmN0aW9uKFxuXHQkUUpDQ29tYm9ib3gsICRRSkNTZWxlY3RrZXksICRRSkNMaXN0dmlldywgJFFKQ0ZpbHRlciwgJFFKTG9nZ2VyLCAkUUpIZWxwZXJGdW5jdGlvbnMsICRzY29wZSwgJHJvb3RTY29wZSwgJFFKTG9naW5Nb2R1bGUsICRRSkFwaSwgJHRpbWVvdXQsICRzdGF0ZSwgJFFKTG9naW5Nb2R1bGVcbikge1xuXG5cdCRRSkxvZ2dlci5sb2coXCJQcm9maWxlTGlzdENvbnRyb2xsZXIgLT4gaW5pdGlhbGl6ZWRcIik7XG5cdCRzY29wZS5icmVhZGNydW1iID0ge1xuXHRcdG5hbWU6ICdQcm9maWxlcycsXG5cdFx0bGlzdDogW10sXG5cdFx0YWN0aXZlOiBcIlByb2ZpbGVzXCJcblx0fTtcblx0JHNjb3BlLml0ZW1zID0gW107IC8vaG9sZHMgaXRlbXMgZnJvbSBkYlxuXHQkc2NvcGUubHZ3RGF0YSA9IG51bGw7IC8vaG9sZHMgaXRlbXMgZGl2aWRlZCBwZXIgcGFnZVxuXG5cdC8vZmlsdGVyXG5cdCRRSkNGaWx0ZXIuY3JlYXRlKHtcblx0XHRuYW1lOiAnZmlsdGVyJyxcblx0XHRmaWVsZHM6IFt7XG5cdFx0XHRuYW1lOiAnZGVzY3JpcHRpb24nLFxuXHRcdFx0YXJyYXlOYW1lOiAnaXRlbXMnLFxuXHRcdFx0YmluZFRvOiBbJ2Rlc2NyaXB0aW9uJ11cblx0XHR9XVxuXHR9LCAkc2NvcGUpO1xuXG5cdGZ1bmN0aW9uIGxvYWRDb250cm9scygpIHtcblx0XHQvL2xpc3R2aWV3XG5cdFx0JFFKQ0xpc3R2aWV3LmNyZWF0ZSh7XG5cdFx0XHRuYW1lOiAnbHZ3Jyxcblx0XHRcdGRhdGFBcnJheTogJ2l0ZW1zJyxcblx0XHRcdHBhZ2VkRGF0YUFycmF5OiAnbHZ3RGF0YScsXG5cdFx0XHRhcGk6IHtcblx0XHRcdFx0Y29udHJvbGxlcjogJ3Byb2ZpbGUnLFxuXHRcdFx0XHRwYXJhbXM6IHtcblx0XHRcdFx0XHRhY3Rpb246ICdjb21ib2JveF9hbGwnXG5cdFx0XHRcdH1cblx0XHRcdH0sXG5cdFx0XHRjb2x1bW5zOiBbe1xuXHRcdFx0XHRuYW1lOiAnZGVzY3JpcHRpb24nLFxuXHRcdFx0XHRsYWJlbDogJ0Rlc2NyaXB0aW9uJ1xuXHRcdFx0fV0sXG5cdFx0XHRpdGVtQ2xpY2s6IGZ1bmN0aW9uKGl0ZW0pIHtcblx0XHRcdFx0JFFKSGVscGVyRnVuY3Rpb25zLmNoYW5nZVN0YXRlKCdtb2R1bGUtcHJvZmlsZS1lZGl0Jywge1xuXHRcdFx0XHRcdGlkOiBpdGVtLl9pZFxuXHRcdFx0XHR9KTtcblx0XHRcdH1cblx0XHR9LCAkc2NvcGUpO1xuXHR9XG5cblxuXHQvL0xvYWQgY29udHJvbHMgd2hlbiBjdXJyZW50IGl0ZW0gaXRzIGF2YWxpYWJsZS5cblx0dmFyIGNvbnRyb2xzTG9hZGVkID0gZmFsc2U7XG5cdCRyb290U2NvcGUuJG9uKCdjdXJyZW50VXNlci5jaGFuZ2UnLCBmdW5jdGlvbigpIHtcblx0XHRsb2FkQ29udHJvbHMoKTtcblx0XHRjb250cm9sc0xvYWRlZCA9IHRydWU7XG5cdH0pO1xuXHRpZiAoIWNvbnRyb2xzTG9hZGVkICYmICFfLmlzVW5kZWZpbmVkKCRyb290U2NvcGUuY3VycmVudFVzZXIpKSB7XG5cdFx0bG9hZENvbnRyb2xzKCk7XG5cdFx0Y29udHJvbHNMb2FkZWQgPSB0cnVlO1xuXHR9XG5cdC8vZGVmYXVsdHNcblx0JHRpbWVvdXQoZnVuY3Rpb24oKSB7XG5cdFx0JHNjb3BlLmZpbHRlci5maWx0ZXIoKTtcblx0fSwgMjAwMCk7XG59KVxuXG5tb2R1bGUuY29udHJvbGxlcignUHJvZmlsZUVkaXRDb250cm9sbGVyJywgZnVuY3Rpb24oXG5cdCRRSkNDb21ib2JveCwgJFFKQ1NlbGVjdGtleSwgJFFKQ0xpc3R2aWV3LCAkUUpDRmlsdGVyLCAkUUpMb2dnZXIsICRRSkhlbHBlckZ1bmN0aW9ucywgJHNjb3BlLCAkcm9vdFNjb3BlLCAkUUpMb2dpbk1vZHVsZSwgJFFKQXBpLCAkdGltZW91dCwgJHN0YXRlLCAkUUpMb2dpbk1vZHVsZVxuKSB7XG5cblx0JFFKTG9nZ2VyLmxvZyhcIlByb2ZpbGVFZGl0Q29udHJvbGxlciAtPiBpbml0aWFsaXplZFwiKTtcblx0JHNjb3BlLmJyZWFkY3J1bWIgPSB7XG5cdFx0bmFtZTogJ1Byb2ZpbGUgRWRpdCcsXG5cdFx0bGlzdDogW3tcblx0XHRcdG5hbWU6IFwiUHJvZmlsZXNcIixcblx0XHRcdHN0YXRlOiAnbW9kdWxlLXByb2ZpbGUtbGlzdCcsXG5cdFx0XHQvL2ZhOiAnZmEtZGFzaGJvYXJkJ1xuXHRcdH0sIF0sXG5cdFx0YWN0aXZlOiBcIkxvYWRpbmcuLi5cIlxuXHR9O1xuXG5cblxuXHR2YXIgX2lkID0gJHN0YXRlLnBhcmFtcy5pZDtcblxuXHQkc2NvcGUuY3J1ZCA9IHtcblx0XHRlcnJvcnM6IFtdXG5cdH1cblxuXHRmdW5jdGlvbiBzaG93RXJyb3IoZXJyb3IpIHtcblx0XHQkc2NvcGUuY3J1ZC5lcnJvcnMucHVzaChlcnJvcik7XG5cdFx0cmV0dXJuIHRydWU7XG5cdH1cblxuXHRmdW5jdGlvbiBmb3JtSGFzRXJyb3JzKCkge1xuXHRcdCRzY29wZS5jcnVkLmVycm9ycyA9IFtdO1xuXHRcdHZhciBoYXNFcnJvcnMgPSBmYWxzZTtcblx0XHRpZiAoXy5pc1VuZGVmaW5lZCgkc2NvcGUuaXRlbS5kZXNjcmlwdGlvbikgfHwgJHNjb3BlLml0ZW0uZGVzY3JpcHRpb24gPT0gJycpIHtcblx0XHRcdGhhc0Vycm9ycyA9IHNob3dFcnJvcignRGVzY3JpcHRpb24gcmVxdWlyZWQnKTtcblx0XHR9XG5cdFx0cmV0dXJuIGhhc0Vycm9ycztcblx0fVxuXG5cdCRzY29wZS5zYXZlID0gZnVuY3Rpb24oKSB7XG5cdFx0aWYgKCFmb3JtSGFzRXJyb3JzKCkpIHtcblx0XHRcdCRRSkFwaS5nZXRDb250cm9sbGVyKCdwcm9maWxlJykucG9zdCh7XG5cdFx0XHRcdGFjdGlvbjogJ3NhdmUnXG5cdFx0XHR9LCAkc2NvcGUuaXRlbSwgZnVuY3Rpb24ocmVzKSB7XG5cdFx0XHRcdCRRSkxvZ2dlci5sb2coXCJQcm9maWxlRWRpdENvbnRyb2xsZXIgLT4gYXBpIHBvc3QgLT4gc2F2ZSAtPiBzdWNjZXNzXCIpO1xuXHRcdFx0XHQvL1xuXHRcdFx0XHRzaG93RXJyb3IoJ0NhbWJpb3MgZ3VhcmRhZG9zJyk7XG5cdFx0XHRcdCRRSkhlbHBlckZ1bmN0aW9ucy5jaGFuZ2VTdGF0ZSgnbW9kdWxlLXByb2ZpbGUtbGlzdCcse30sNTAwKTtcblx0XHRcdH0pO1xuXHRcdH07XG5cdH07XG5cdCRzY29wZS5kZWxldGUgPSBmdW5jdGlvbigpIHtcblx0XHR2YXIgciA9IGNvbmZpcm0oXCJEZWxldGUgXCIgKyAkc2NvcGUuaXRlbS5uYW1lICsgXCIgP1wiKTtcblx0XHRpZiAociA9PSB0cnVlKSB7XG5cdFx0XHQkUUpBcGkuZ2V0Q29udHJvbGxlcigncHJvZmlsZScpLnBvc3Qoe1xuXHRcdFx0XHRhY3Rpb246ICdkZWxldGUnXG5cdFx0XHR9LCAkc2NvcGUuaXRlbSwgZnVuY3Rpb24ocmVzKSB7XG5cdFx0XHRcdCRRSkxvZ2dlci5sb2coXCJQcm9maWxlRWRpdENvbnRyb2xsZXIgLT4gZGVsZXRlIC0+IHN1Y2Nlc3NcIik7XG5cdFx0XHRcdC8vXG5cdFx0XHRcdHNob3dFcnJvcignQ2FtYmlvcyBndWFyZGFkb3MnKTtcblx0XHRcdFx0c2hvd0Vycm9yKCRzY29wZS5pdGVtLmRlc2NyaXB0aW9uICsgJyBlbGltaW5hZG8nKTtcblx0XHRcdFx0Ly9cblx0XHRcdFx0JFFKSGVscGVyRnVuY3Rpb25zLmNoYW5nZVN0YXRlKCdtb2R1bGUtcHJvZmlsZS1saXN0Jyx7fSw1MDApO1xuXG5cdFx0XHRcdGNyZWF0ZSgpO1xuXHRcdFx0fSk7XG5cdFx0fSBlbHNlIHt9XG5cdH1cblx0JHNjb3BlLmNhbmNlbCA9IGZ1bmN0aW9uKCkge1xuXHRcdCRRSkhlbHBlckZ1bmN0aW9ucy5jaGFuZ2VTdGF0ZSgnbW9kdWxlLXByb2ZpbGUtbGlzdCcpO1xuXHR9O1xuXG5cdGZ1bmN0aW9uIGxvYWRDb250cm9scygpIHt9XG5cblx0ZnVuY3Rpb24gY3JlYXRlKCkge1xuXHRcdCRRSkxvZ2dlci5sb2coXCJQcm9maWxlRWRpdENvbnRyb2xsZXIgLT4gY3JlYXRlIG5ldyFcIik7XG5cdFx0JHNjb3BlLml0ZW0gPSB7XG5cdFx0XHRkZXNjcmlwdGlvbjogJycsXG5cdFx0XHRfaWQ6IC0xXG5cdFx0fTtcblx0fVxuXHRpZiAoX2lkID09IC0xKSB7XG5cdFx0Ly9DUkVBVEVcblx0XHRjcmVhdGUoKTtcblx0XHRsb2FkQ29udHJvbHMoKTtcblx0fSBlbHNlIHtcblx0XHQvL0dFVCBTSU5HTEUgVVNFUlxuXHRcdCRRSkFwaS5nZXRDb250cm9sbGVyKCdwcm9maWxlJykuZ2V0KHtcblx0XHRcdGFjdGlvbjogJ3NpbmdsZScsXG5cdFx0XHRpZDogX2lkXG5cdFx0fSwgZnVuY3Rpb24ocmVzKSB7XG5cdFx0XHQkUUpMb2dnZXIubG9nKFwiUHJvZmlsZUVkaXRDb250cm9sbGVyIC0+IGFwaSBnZXQgLT4gc2luZ2xlIC0+IHN1Y2Nlc3NcIik7XG5cdFx0XHQkc2NvcGUuaXRlbSA9IHJlcy5pdGVtO1xuXHRcdFx0JHNjb3BlLmJyZWFkY3J1bWIuYWN0aXZlID0gJHNjb3BlLml0ZW0uZGVzY3JpcHRpb247XG5cdFx0XHRsb2FkQ29udHJvbHMoKTtcblx0XHR9KTtcblx0fVxuXG59KTtcblxuO1xufSkuY2FsbCh0aGlzLHJlcXVpcmUoXCIrN1pKcDBcIiksdHlwZW9mIHNlbGYgIT09IFwidW5kZWZpbmVkXCIgPyBzZWxmIDogdHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiA/IHdpbmRvdyA6IHt9LHJlcXVpcmUoXCJidWZmZXJcIikuQnVmZmVyLGFyZ3VtZW50c1szXSxhcmd1bWVudHNbNF0sYXJndW1lbnRzWzVdLGFyZ3VtZW50c1s2XSxcIi8uLi9jb250cm9sbGVycy9tb2QucHJvZmlsZUN0cmwuanNcIixcIi8uLi9jb250cm9sbGVyc1wiKSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbnZhciBtb2R1bGUgPSByZXF1aXJlKCcuL19tb2R1bGVfaW5pdC5qcycpO1xubW9kdWxlLmNvbnRyb2xsZXIoJ1Byb2plY3RIb3Vyc0xpc3RDb250cm9sbGVyJywgZnVuY3Rpb24oXG4gICAgJFFKTG9jYWxTZXNzaW9uLCAkUUpDVGltZUNvdW50ZXIsICRpbnRlcnZhbCwgJFFKQ0NvbWJvYm94LCAkUUpDU2VsZWN0a2V5LCAkUUpDTGlzdHZpZXcsICRRSkNGaWx0ZXIsICRRSkxvZ2dlciwgJFFKSGVscGVyRnVuY3Rpb25zLCAkc2NvcGUsICRyb290U2NvcGUsICRRSkxvZ2luTW9kdWxlLCAkUUpBcGksICR0aW1lb3V0LCAkc3RhdGUsICRRSkxvZ2luTW9kdWxlXG4pIHtcbiAgICAkUUpMb2dnZXIubG9nKFwiUHJvamVjdExpc3RDb250cm9sbGVyIC0+IGluaXRpYWxpemVkXCIpO1xuXG5cbiAgICAkc2NvcGUuYnJlYWRjcnVtYiA9IHtcbiAgICAgICAgbmFtZTogJ1Byb2plY3RzIEhvdXJzJyxcbiAgICAgICAgbGlzdDogW3tcbiAgICAgICAgICAgIG5hbWU6ICdQcm9qZWN0cycsXG4gICAgICAgICAgICBzdGF0ZTogJ21vZHVsZS1wcm9qZWN0LWxpc3QnLFxuICAgICAgICAgICAgLy9mYTogJ2ZhLWRhc2hib2FyZCdcbiAgICAgICAgfV0sXG4gICAgICAgIGFjdGl2ZTogXCJQcm9qZWN0cyBIb3Vyc1wiXG4gICAgfTtcblxuXG4gICAgZy5Qcm9qZWN0TGlzdENvbnRyb2xsZXIgPSAkc2NvcGU7XG5cbiAgICAkc2NvcGUuaXRlbXMgPSBbXTsgLy9ob2xkcyBwcm9qZWN0cyBmcm9tIGRiXG4gICAgJHNjb3BlLml0ZW1zRGF0YSA9IG51bGw7IC8vaG9sZHMgcHJvamVjdHMgZGl2aWRlZCBwZXIgcGFnZVxuXG4gICAgLy9maWx0ZXJcbiAgICAkUUpDRmlsdGVyLmNyZWF0ZSh7XG4gICAgICAgIG5hbWU6ICdwcm9qZWN0aG91cnNGaWx0ZXInLFxuICAgICAgICBmaWVsZHM6IFt7XG4gICAgICAgICAgICBuYW1lOiAnbG9naW5uYW1lJyxcbiAgICAgICAgICAgIGFycmF5TmFtZTogJ2l0ZW1zJyxcbiAgICAgICAgICAgIGJpbmRUbzogWydsb2dpbm5hbWUnXVxuICAgICAgICB9LCB7XG4gICAgICAgICAgICBuYW1lOiAnX2lkX2NvbXBhbnknLFxuICAgICAgICAgICAgYXJyYXlOYW1lOiAnaXRlbXMnLFxuICAgICAgICAgICAgYmluZFRvOiBbJ19pZF9jb21wYW55J11cbiAgICAgICAgfSwge1xuICAgICAgICAgICAgbmFtZTogJ19pZF9wcm9qZWN0JyxcbiAgICAgICAgICAgIGFycmF5TmFtZTogJ2l0ZW1zJyxcbiAgICAgICAgICAgIGJpbmRUbzogWydfaWRfcHJvamVjdCddXG4gICAgICAgIH0sIHtcbiAgICAgICAgICAgIG5hbWU6ICdfaWRfdXNlcicsXG4gICAgICAgICAgICBhcnJheU5hbWU6ICdpdGVtcycsXG4gICAgICAgICAgICBiaW5kVG86IFsnX2lkX3VzZXInXVxuICAgICAgICB9XVxuICAgIH0sICRzY29wZSk7XG5cblxuICAgIGZ1bmN0aW9uIGxvYWRDb250cm9scygpIHtcblxuICAgICAgICAvLy0tLS0tLS0tXG4gICAgICAgIC8vY29tYm9ib3hcbiAgICAgICAgJFFKQ0NvbWJvYm94LmNyZWF0ZSh7XG4gICAgICAgICAgICBuYW1lOiAnaG91cnNjb21wYW55Q0JPJyxcbiAgICAgICAgICAgIGxhYmVsOiBcIkNvbXBhbnlcIixcbiAgICAgICAgICAgIGNvZGU6ICRyb290U2NvcGUuc2Vzc2lvbi5wcm9qZWN0aG91cnNfaG91cnNjb21wYW55Q0JPQ09ERSB8fCAtMSwgLy8kcm9vdFNjb3BlLmN1cnJlbnRVc2VyLl9ncm91cF9pZCxcbiAgICAgICAgICAgIGNvZGVfY29weXRvOiAnaG91cnNwcm9qZWN0Q0JPLmFwaS5wYXJhbXMuX2lkX2NvbXBhbnknLFxuICAgICAgICAgICAgLy9kZXNjcmlwdGlvbl9jb3B5dG86ICdjdXJyZW50LmNvbXBhbnknLFxuICAgICAgICAgICAgYXBpOiB7XG4gICAgICAgICAgICAgICAgY29udHJvbGxlcjogJ2NvbXBhbnknLFxuICAgICAgICAgICAgICAgIHBhcmFtczoge1xuICAgICAgICAgICAgICAgICAgICBhY3Rpb246ICdjb21ib2JveF9hbGwnXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgfSwgJHNjb3BlKTtcbiAgICAgICAgLy9jb21ib2JveFxuICAgICAgICAkUUpDQ29tYm9ib3guY3JlYXRlKHtcbiAgICAgICAgICAgIG5hbWU6ICdob3Vyc3Byb2plY3RDQk8nLFxuICAgICAgICAgICAgbGFiZWw6IFwiUHJvamVjdFwiLFxuICAgICAgICAgICAgY29kZTogJHJvb3RTY29wZS5zZXNzaW9uLnByb2plY3Rob3Vyc19ob3Vyc3Byb2plY3RDQk9DT0RFIHx8IC0xLCAvLyRyb290U2NvcGUuY3VycmVudFVzZXIuX2dyb3VwX2lkLFxuICAgICAgICAgICAgY29kZV9jb3B5dG86ICdjdXJyZW50Lml0ZW0uX2lkX3Byb2plY3QnLFxuICAgICAgICAgICAgZGVzY3JpcHRpb25fY29weXRvOiAnY3VycmVudC5wcm9qZWN0JyxcbiAgICAgICAgICAgIGFwaToge1xuICAgICAgICAgICAgICAgIGNvbnRyb2xsZXI6ICdwcm9qZWN0JyxcbiAgICAgICAgICAgICAgICBwYXJhbXM6IHtcbiAgICAgICAgICAgICAgICAgICAgYWN0aW9uOiAnY29tYm9ib3hfYWxsJyxcbiAgICAgICAgICAgICAgICAgICAgX2lkX2NvbXBhbnk6ICRzY29wZS5ob3Vyc2NvbXBhbnlDQk8uY29kZSB8fCAtMVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgIH0sICRzY29wZSlcbiAgICAgICAgLy8tLS0tLS0tLVxuXG5cbiAgICAgICAgLy9jb21ib2JveFxuICAgICAgICAkUUpDQ29tYm9ib3guY3JlYXRlKHtcbiAgICAgICAgICAgIG5hbWU6ICdjb21wYW55Q0JPJyxcbiAgICAgICAgICAgIGxhYmVsOiBcIkNvbXBhbnlcIixcbiAgICAgICAgICAgIGNvZGU6IC0xLCAvLyRyb290U2NvcGUuY3VycmVudFVzZXIuX2dyb3VwX2lkLFxuICAgICAgICAgICAgY29kZV9jb3B5dG86ICdwcm9qZWN0aG91cnNGaWx0ZXIuZmllbGRzLl9pZF9jb21wYW55JyxcbiAgICAgICAgICAgIGFwaToge1xuICAgICAgICAgICAgICAgIGNvbnRyb2xsZXI6ICdjb21wYW55JyxcbiAgICAgICAgICAgICAgICBwYXJhbXM6IHtcbiAgICAgICAgICAgICAgICAgICAgYWN0aW9uOiAnY29tYm9ib3hfYWxsJ1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgIH0sICRzY29wZSk7XG4gICAgICAgIC8vY29tYm9ib3hcbiAgICAgICAgJFFKQ0NvbWJvYm94LmNyZWF0ZSh7XG4gICAgICAgICAgICBuYW1lOiAncHJvamVjdENCTycsXG4gICAgICAgICAgICBsYWJlbDogXCJQcm9qZWN0XCIsXG4gICAgICAgICAgICBjb2RlOiAtMSwgLy8kcm9vdFNjb3BlLmN1cnJlbnRVc2VyLl9ncm91cF9pZCxcbiAgICAgICAgICAgIGNvZGVfY29weXRvOiAncHJvamVjdGhvdXJzRmlsdGVyLmZpZWxkcy5faWRfcHJvamVjdCcsXG4gICAgICAgICAgICBhcGk6IHtcbiAgICAgICAgICAgICAgICBjb250cm9sbGVyOiAncHJvamVjdCcsXG4gICAgICAgICAgICAgICAgcGFyYW1zOiB7XG4gICAgICAgICAgICAgICAgICAgIGFjdGlvbjogJ2NvbWJvYm94X2FsbCdcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICB9LCAkc2NvcGUpO1xuICAgICAgICAvL2NvbWJvYm94XG4gICAgICAgICRRSkNDb21ib2JveC5jcmVhdGUoe1xuICAgICAgICAgICAgbmFtZTogJ3VzZXJDQk8nLFxuICAgICAgICAgICAgbGFiZWw6IFwiVXNlclwiLFxuICAgICAgICAgICAgY29kZTogLTEsIC8vJHJvb3RTY29wZS5jdXJyZW50VXNlci5fZ3JvdXBfaWQsXG4gICAgICAgICAgICBjb2RlX2NvcHl0bzogJ3Byb2plY3Rob3Vyc0ZpbHRlci5maWVsZHMuX2lkX3VzZXInLFxuICAgICAgICAgICAgYXBpOiB7XG4gICAgICAgICAgICAgICAgY29udHJvbGxlcjogJ3VzZXInLFxuICAgICAgICAgICAgICAgIHBhcmFtczoge1xuICAgICAgICAgICAgICAgICAgICBhY3Rpb246ICdjb21ib2JveF9hbGwnXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgfSwgJHNjb3BlKTtcblxuXG5cbiAgICAgICAgLy9saXN0dmlld1xuICAgICAgICAkUUpDTGlzdHZpZXcuY3JlYXRlKHtcbiAgICAgICAgICAgIG5hbWU6ICdwcm9qZWN0c2hvdXJzTFZXJyxcbiAgICAgICAgICAgIGRhdGFBcnJheTogJ2l0ZW1zJyxcbiAgICAgICAgICAgIHBhZ2VkRGF0YUFycmF5OiAnaXRlbXNEYXRhJyxcbiAgICAgICAgICAgIGFwaToge1xuICAgICAgICAgICAgICAgIGNvbnRyb2xsZXI6ICdwcm9qZWN0JyxcbiAgICAgICAgICAgICAgICBwYXJhbXM6IHtcbiAgICAgICAgICAgICAgICAgICAgYWN0aW9uOiAnaG91cnNfYWxsJyxcbiAgICAgICAgICAgICAgICAgICAgX2lkX3Byb2plY3Q6IC0xXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGNvbHVtbnM6IFt7XG4gICAgICAgICAgICAgICAgbmFtZTogJ2xvZ2lubmFtZScsXG4gICAgICAgICAgICAgICAgbGFiZWw6ICdVc2VyJ1xuICAgICAgICAgICAgfSwge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdkaWZmZXJlbmNlRm9ybWF0ZWQnLFxuICAgICAgICAgICAgICAgIGxhYmVsOiAnVGllbXBvIChobXMpJ1xuICAgICAgICAgICAgfSwge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdzdGFydEZvcm1hdGVkJyxcbiAgICAgICAgICAgICAgICBsYWJlbDogJ1N0YXJ0J1xuICAgICAgICAgICAgfSwge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdlbmRGb3JtYXRlZCcsXG4gICAgICAgICAgICAgICAgbGFiZWw6ICdFbmQnXG4gICAgICAgICAgICB9XSxcbiAgICAgICAgICAgIGl0ZW1DbGljazogZnVuY3Rpb24oaXRlbSkge1xuICAgICAgICAgICAgICAgICRRSkhlbHBlckZ1bmN0aW9ucy5jaGFuZ2VTdGF0ZSgnbW9kdWxlLXByb2plY3QtaG91cnMtZWRpdCcsIHtcbiAgICAgICAgICAgICAgICAgICAgaWQ6IGl0ZW0uX2lkXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sICRzY29wZSk7XG5cbiAgICAgICAgJHNjb3BlLiRvbihcInByb2plY3RzaG91cnNMVlcudXBkYXRlXCIsIGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgLy9jb25zb2xlLmluZm8oXCJwcm9qZWN0c2hvdXJzTFZXLnVwZGF0ZVwiKTtcbiAgICAgICAgICAgICRzY29wZS5pdGVtcyA9IF8uZWFjaCgkc2NvcGUuaXRlbXMsIGZ1bmN0aW9uKGl0ZW0pIHtcbiAgICAgICAgICAgICAgICB2YXIgZGlmZiA9IGl0ZW0uZGlmZmVyZW5jZTtcbiAgICAgICAgICAgICAgICB2YXIgZHVyYXRpb24gPSB7XG4gICAgICAgICAgICAgICAgICAgIGhvdXJzOiBNYXRoLnJvdW5kKChkaWZmIC8gMTAwMCAvIDYwIC8gNjApICUgMjQpLFxuICAgICAgICAgICAgICAgICAgICBtaW51dGVzOiBNYXRoLnJvdW5kKChkaWZmIC8gMTAwMCAvIDYwKSAlIDYwKSxcbiAgICAgICAgICAgICAgICAgICAgc2Vjb25kczogTWF0aC5yb3VuZCgoZGlmZiAvIDEwMDApICUgNjApXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICB2YXIgc3RyID0gXCJcIjtcbiAgICAgICAgICAgICAgICBzdHIgKz0gZHVyYXRpb24uaG91cnMgKyBcIjpcIjtcbiAgICAgICAgICAgICAgICBzdHIgKz0gZHVyYXRpb24ubWludXRlcyArIFwiOlwiO1xuICAgICAgICAgICAgICAgIHN0ciArPSBkdXJhdGlvbi5zZWNvbmRzICsgXCJcIjtcbiAgICAgICAgICAgICAgICBpdGVtLmRpZmZlcmVuY2VGb3JtYXRlZCA9IHN0cjtcbiAgICAgICAgICAgICAgICBpdGVtLnN0YXJ0Rm9ybWF0ZWQgPSBtb21lbnQocGFyc2VJbnQoaXRlbS5zdGFydCkpLmZvcm1hdChcIkRELU1NLVlZIGg6bW06c3MgYVwiKTtcbiAgICAgICAgICAgICAgICBpdGVtLmVuZEZvcm1hdGVkID0gbW9tZW50KHBhcnNlSW50KGl0ZW0uZW5kKSkuZm9ybWF0KFwiREQtTU0tWVkgaDptbTpzcyBhXCIpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAvLyRRSkxvZ2dlci5sb2coXCJwcm9qZWN0c2hvdXJzTFZXLnVwZGF0ZVwiKTtcbiAgICAgICAgfSk7XG5cblxuXG4gICAgfVxuXG5cblxuICAgICRRSkNUaW1lQ291bnRlci5jcmVhdGUoe1xuICAgICAgICBuYW1lOiAnY3VycmVudCcsXG4gICAgICAgIGFwaToge1xuICAgICAgICAgICAgY29udHJvbGxlcjogJ3Byb2plY3QnLFxuICAgICAgICAgICAgcGFyYW1zOiB7XG4gICAgICAgICAgICAgICAgYWN0aW9uOiAnaG91cnNfY3VycmVudCcsXG4gICAgICAgICAgICAgICAgX2lkX3Byb2plY3Q6IC0xXG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIG9uSW5pdDogZnVuY3Rpb24oc2VsZikge1xuICAgICAgICAgICAgaWYgKF8uaXNVbmRlZmluZWQoc2VsZi5yZXNpdGVtKSB8fCBfLmlzTnVsbChzZWxmLnJlc2l0ZW0pKSB7XG4gICAgICAgICAgICAgICAgc2VsZi5pdGVtID0ge1xuICAgICAgICAgICAgICAgICAgICBfaWQ6IC0xLFxuICAgICAgICAgICAgICAgICAgICBfaWRfcHJvamVjdDogJHNjb3BlLmhvdXJzcHJvamVjdENCTy5jb2RlLFxuICAgICAgICAgICAgICAgICAgICBfaWRfdXNlcjogbnVsbCwgLy9zYXZlIGN1cnJlbnQgYmFzZWQgb24gdG9rZW4uXG4gICAgICAgICAgICAgICAgICAgIHN0YXJ0OiBudWxsLFxuICAgICAgICAgICAgICAgICAgICBlbmQ6IG51bGwsXG4gICAgICAgICAgICAgICAgICAgIGRpZmZlcmVuY2U6IG51bGxcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBzZWxmLml0ZW0gPSBzZWxmLnJlc2l0ZW07XG4gICAgICAgICAgICAgICAgc2VsZi5yZXN1bWUoc2VsZi5pdGVtLnN0YXJ0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgb25TdGFydENoYW5nZTogZnVuY3Rpb24obmV3VmFsLCBzZWxmKSB7XG4gICAgICAgICAgICBzZWxmLml0ZW0uc3RhcnQgPSBuZXdWYWw7XG4gICAgICAgIH0sXG4gICAgICAgIG9uU3RvcENoYW5nZTogZnVuY3Rpb24obmV3VmFsLCBzZWxmKSB7XG4gICAgICAgICAgICBzZWxmLml0ZW0uZW5kID0gbmV3VmFsO1xuICAgICAgICB9LFxuICAgICAgICBvbkRpZmZDaGFuZ2U6IGZ1bmN0aW9uKG5ld1ZhbCwgbmV3VmFsRm9ybWF0ZWQsIHNlbGYpIHtcbiAgICAgICAgICAgIHNlbGYuaXRlbS5kaWZmZXJlbmNlID0gbmV3VmFsO1xuICAgICAgICB9LFxuICAgICAgICBvblZhbGlkYXRlU3RhcnQ6IGZ1bmN0aW9uKHNlbGYpIHtcbiAgICAgICAgICAgIHZhciB2YWwgPSAhXy5pc1VuZGVmaW5lZChzZWxmLml0ZW0pICYmICFfLmlzVW5kZWZpbmVkKHNlbGYuaXRlbS5faWRfcHJvamVjdCkgJiYgc2VsZi5pdGVtLl9pZF9wcm9qZWN0ICE9IG51bGwgJiYgc2VsZi5pdGVtLl9pZF9wcm9qZWN0ICE9IFwiXCI7XG4gICAgICAgICAgICBpZiAoIXZhbCkge1xuICAgICAgICAgICAgICAgIHNlbGYuZXJyb3JzID0gW107XG4gICAgICAgICAgICAgICAgc2VsZi5hZGRFcnJvcihcIlByb2plY3QgcmVxdWlyZWRcIik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdmFsO1xuICAgICAgICB9LFxuICAgICAgICBvblN0YXJ0Q2xpY2s6IGZ1bmN0aW9uKHNlbGYpIHtcbiAgICAgICAgICAgICRzY29wZS5ob3Vyc2NvbXBhbnlDQk8uZGlzYWJsZWQgPSB0cnVlO1xuICAgICAgICAgICAgJHNjb3BlLmhvdXJzcHJvamVjdENCTy5kaXNhYmxlZCA9IHRydWU7XG4gICAgICAgICAgICAvL1xuICAgICAgICAgICAgJFFKQXBpLmdldENvbnRyb2xsZXIoXCJwcm9qZWN0XCIpLnBvc3Qoe1xuICAgICAgICAgICAgICAgIGFjdGlvbjogJ2hvdXJzX3NhdmUnXG4gICAgICAgICAgICB9LCBzZWxmLml0ZW0sIGZ1bmN0aW9uKHJlcykge1xuICAgICAgICAgICAgICAgICRRSkxvZ2dlci5sb2coXCJob3VycyAtPiBzYXZlIC0+IHN1Y2Nlc3NcIik7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSxcbiAgICAgICAgb25TdG9wQ2xpY2s6IGZ1bmN0aW9uKHNlbGYpIHtcbiAgICAgICAgICAgICRzY29wZS5ob3Vyc2NvbXBhbnlDQk8uZGlzYWJsZWQgPSBmYWxzZTtcbiAgICAgICAgICAgICRzY29wZS5ob3Vyc3Byb2plY3RDQk8uZGlzYWJsZWQgPSBmYWxzZTtcbiAgICAgICAgICAgIC8vXG4gICAgICAgICAgICAkUUpBcGkuZ2V0Q29udHJvbGxlcihcInByb2plY3RcIikucG9zdCh7XG4gICAgICAgICAgICAgICAgYWN0aW9uOiAnaG91cnNfc2F2ZSdcbiAgICAgICAgICAgIH0sIHNlbGYuaXRlbSwgZnVuY3Rpb24ocmVzKSB7XG4gICAgICAgICAgICAgICAgJFFKTG9nZ2VyLmxvZyhcImhvdXJzIC0+IHNhdmUgLT4gc3VjY2Vzc1wiKTtcbiAgICAgICAgICAgICAgICBzZWxmLmFkZEVycm9yKFwiRHVyYXRpb246IFwiICsgJFFKSGVscGVyRnVuY3Rpb25zLmdldFRpbWVzdGFtcER1cmF0aW9uKHNlbGYuaXRlbS5kaWZmZXJlbmNlKSk7XG4gICAgICAgICAgICAgICAgc2VsZi5hZGRFcnJvcihcIlRpbWVzdGFtcCBzYXZlZFwiKTtcbiAgICAgICAgICAgICAgICAkc2NvcGUucHJvamVjdHNob3Vyc0xWVy51cGRhdGUoKTtcbiAgICAgICAgICAgICAgICAkc2NvcGUuJGVtaXQoJ3Byb2plY3QudXBkYXRlJywge1xuICAgICAgICAgICAgICAgICAgICBpbml0aWFsaXplVGltZXI6IGZhbHNlXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIC8vXG5cbiAgICAgICAgICAgIGlmICgkc2NvcGUucHJvamVjdGluZm8pIHtcbiAgICAgICAgICAgICAgICAkc2NvcGUucHJvamVjdGluZm8uc2hvdyA9IGZhbHNlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSwgJHNjb3BlKTsgLy8uaW5pdCgpO1xuICAgICRzY29wZS4kb24oJ2hvdXJzcHJvamVjdENCTy5jaGFuZ2UnLCBmdW5jdGlvbigpIHtcbiAgICAgICAgJHNjb3BlLiRlbWl0KCdwcm9qZWN0LnVwZGF0ZScsIHtcbiAgICAgICAgICAgIGluaXRpYWxpemVUaW1lcjogdHJ1ZVxuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgICRzY29wZS4kb24oJ3Byb2plY3QudXBkYXRlJywgZnVuY3Rpb24oYXJnLCBwYXJhbXMpIHtcblxuICAgICAgICAvL3N0b3JlcyBjb21wYW55LHByb2plY3RcbiAgICAgICAgJHJvb3RTY29wZS5zZXNzaW9uLnByb2plY3Rob3Vyc19ob3Vyc2NvbXBhbnlDQk9DT0RFID0gJHNjb3BlLmhvdXJzY29tcGFueUNCTy5jb2RlO1xuICAgICAgICAkcm9vdFNjb3BlLnNlc3Npb24ucHJvamVjdGhvdXJzX2hvdXJzcHJvamVjdENCT0NPREUgPSAkc2NvcGUuaG91cnNwcm9qZWN0Q0JPLmNvZGU7XG4gICAgICAgICRRSkxvY2FsU2Vzc2lvbi5zYXZlKCk7XG5cblxuICAgICAgICB2YXIgX2lkX3Byb2plY3QgPSAkc2NvcGUuaG91cnNwcm9qZWN0Q0JPLmNvZGU7IC8vVVBEQVRFIElORk9STUFUSU9OIEFCT1VUIFBST0pFQ1QgSE9VUlNcbiAgICAgICAgaWYgKF9pZF9wcm9qZWN0ICE9IC0xKSB7XG4gICAgICAgICAgICB1cGRhdGVQcm9qZWN0SW5mbyhfaWRfcHJvamVjdCk7XG5cbiAgICAgICAgICAgIGlmIChwYXJhbXMuaW5pdGlhbGl6ZVRpbWVyKSB7XG4gICAgICAgICAgICAgICAgJHNjb3BlLmN1cnJlbnQuYXBpLnBhcmFtcy5faWRfcHJvamVjdCA9IF9pZF9wcm9qZWN0OyAvL2lmYSBwcmogaXRzIHNlbGVjdGVkLiBVcGRhdGUgdGltZXIgc3RhdHVzXG4gICAgICAgICAgICAgICAgJHNjb3BlLmN1cnJlbnQuaW5pdCgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICB9KTtcblxuICAgIGZ1bmN0aW9uIHVwZGF0ZVByb2plY3RJbmZvKF9pZF9wcm9qZWN0KSB7XG4gICAgICAgICRRSkFwaS5nZXRDb250cm9sbGVyKFwicHJvamVjdFwiKS5nZXQoe1xuICAgICAgICAgICAgYWN0aW9uOiBcImhvdXJzX2FsbFwiLFxuICAgICAgICAgICAgX2lkX3Byb2plY3Q6IF9pZF9wcm9qZWN0LnRvU3RyaW5nKClcbiAgICAgICAgfSwgZnVuY3Rpb24ocmVzKSB7XG4gICAgICAgICAgICAkUUpMb2dnZXIubG9nKFwicHJvamVjdCBob3Vyc19hbGwgLT4gc3VjY2Vzc1wiKTtcbiAgICAgICAgICAgIHZhciBob3VycyA9IFtdO1xuICAgICAgICAgICAgXy5lYWNoKHJlcy5pdGVtcywgZnVuY3Rpb24oaXRlbSkge1xuICAgICAgICAgICAgICAgIHZhciBleGlzdHMgPSAhXy5pc1VuZGVmaW5lZChfLmZpbmQoaG91cnMsIGZ1bmN0aW9uKGluZm9JdGVtKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBpbmZvSXRlbS5sb2dpbm5hbWUgPT0gaXRlbS5sb2dpbm5hbWU7XG4gICAgICAgICAgICAgICAgfSkpO1xuXG4gICAgICAgICAgICAgICAgaWYgKGl0ZW0uZW5kID09IG51bGwpIGV4aXN0cyA9IHRydWU7IC8vXG4gICAgICAgICAgICAgICAgaWYgKGV4aXN0cykgcmV0dXJuO1xuICAgICAgICAgICAgICAgIHZhciBob3Vyc2Zyb20gPSBfLmZpbHRlcihyZXMuaXRlbXMsIGZ1bmN0aW9uKGkpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGkubG9naW5uYW1lID09IGl0ZW0ubG9naW5uYW1lO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIHZhciBkaWZmID0gMDtcbiAgICAgICAgICAgICAgICBfLmVhY2goaG91cnNmcm9tLCBmdW5jdGlvbihpKSB7XG4gICAgICAgICAgICAgICAgICAgIGRpZmYgKz0gcGFyc2VJbnQoaS5kaWZmZXJlbmNlKTtcbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgIGhvdXJzLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICBsb2dpbm5hbWU6IGl0ZW0ubG9naW5uYW1lLFxuICAgICAgICAgICAgICAgICAgICBkaWZmOiBkaWZmLFxuICAgICAgICAgICAgICAgICAgICBkaWZmRm9ybWF0ZWQ6ICRRSkhlbHBlckZ1bmN0aW9ucy5nZXRUaW1lc3RhbXBEdXJhdGlvbihkaWZmKVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAvL2NvbnNvbGUuaW5mbyhpbmZvKTtcbiAgICAgICAgICAgIHZhciBob3Vyc1RvdGFsID0gMDtcbiAgICAgICAgICAgIF8uZWFjaChob3VycywgZnVuY3Rpb24oaSkge1xuICAgICAgICAgICAgICAgIGhvdXJzVG90YWwgKz0gcGFyc2VJbnQoaS5kaWZmKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgJHNjb3BlLnByb2plY3RpbmZvID0ge1xuICAgICAgICAgICAgICAgIGhvdXJzOiBob3VycyxcbiAgICAgICAgICAgICAgICBob3Vyc1RvdGFsOiBob3Vyc1RvdGFsLFxuICAgICAgICAgICAgICAgIGhvdXJzVG90YWxGb3JtYXRlZDogJFFKSGVscGVyRnVuY3Rpb25zLmdldFRpbWVzdGFtcER1cmF0aW9uKGhvdXJzVG90YWwpLFxuICAgICAgICAgICAgICAgIHNob3c6IHRydWVcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICAvL2NvbnNvbGUuaW5mbygkc2NvcGUucHJvamVjdGluZm8pO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvL0xvYWQgY29udHJvbHMgd2hlbiBjdXJyZW50IHVzZXIgaXRzIGF2YWxpYWJsZS5cbiAgICB2YXIgY29udHJvbHNMb2FkZWQgPSBmYWxzZTtcbiAgICAkcm9vdFNjb3BlLiRvbignY3VycmVudFVzZXIuY2hhbmdlJywgZnVuY3Rpb24oKSB7XG4gICAgICAgIGxvYWRDb250cm9scygpO1xuICAgICAgICBjb250cm9sc0xvYWRlZCA9IHRydWU7XG4gICAgfSk7XG4gICAgaWYgKCFjb250cm9sc0xvYWRlZCAmJiAhXy5pc1VuZGVmaW5lZCgkcm9vdFNjb3BlLmN1cnJlbnRVc2VyKSkge1xuICAgICAgICBsb2FkQ29udHJvbHMoKTtcbiAgICAgICAgY29udHJvbHNMb2FkZWQgPSB0cnVlO1xuICAgIH1cblxuICAgIC8vZGVmYXVsdHNcbiAgICAkdGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgJHNjb3BlLnByb2plY3Rob3Vyc0ZpbHRlci5maWx0ZXIoKTtcbiAgICB9LCAyMDAwKTtcblxuXG4gICAgc2NvcGUgPSAkc2NvcGU7XG5cbn0pXG5cblxuXG5tb2R1bGUuY29udHJvbGxlcignUHJvamVjdEhvdXJzRWRpdENvbnRyb2xsZXInLCBmdW5jdGlvbihcbiAgICAkUUpDQ29tYm9ib3gsICRRSkNTZWxlY3RrZXksICRRSkNMaXN0dmlldywgJFFKQ0ZpbHRlciwgJFFKTG9nZ2VyLCAkUUpIZWxwZXJGdW5jdGlvbnMsICRzY29wZSwgJHJvb3RTY29wZSwgJFFKTG9naW5Nb2R1bGUsICRRSkFwaSwgJHRpbWVvdXQsICRzdGF0ZSwgJFFKTG9naW5Nb2R1bGVcbikge1xuXG5cbiAgICAkUUpMb2dnZXIubG9nKFwiUHJvamVjdEhvdXJzRWRpdENvbnRyb2xsZXIgLT4gaW5pdGlhbGl6ZWRcIik7XG5cblxuICAgICRzY29wZS5icmVhZGNydW1iID0ge1xuICAgICAgICBuYW1lOiAnUHJvamVjdCBIb3VycycsXG4gICAgICAgIGxpc3Q6IFt7XG4gICAgICAgICAgICBuYW1lOiAnUHJvamVjdHMgSG91cnMnLFxuICAgICAgICAgICAgc3RhdGU6ICdtb2R1bGUtcHJvamVjdC1ob3Vycy1saXN0JyxcbiAgICAgICAgICAgIC8vZmE6ICdmYS1kYXNoYm9hcmQnXG4gICAgICAgIH1dLFxuICAgICAgICBhY3RpdmU6IFwiTG9hZGluZ1wiXG4gICAgfTtcblxuXG4gICAgdmFyIF9pZCA9ICRzdGF0ZS5wYXJhbXMuaWQ7XG5cbiAgICAkc2NvcGUuY3J1ZCA9IHtcbiAgICAgICAgZXJyb3JzOiBbXVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNob3dFcnJvcihlcnJvcikge1xuICAgICAgICAkc2NvcGUuY3J1ZC5lcnJvcnMucHVzaChlcnJvcik7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGZvcm1IYXNFcnJvcnMoKSB7XG4gICAgICAgICRzY29wZS5jcnVkLmVycm9ycyA9IFtdO1xuICAgICAgICB2YXIgaGFzRXJyb3JzID0gZmFsc2U7XG4gICAgICAgIGlmIChfLmlzVW5kZWZpbmVkKCRzY29wZS5pdGVtLnN0YXJ0KSB8fCAkc2NvcGUuaXRlbS5zdGFydCA9PSAnJykge1xuICAgICAgICAgICAgaGFzRXJyb3JzID0gc2hvd0Vycm9yKCdTdGFydCByZXF1aXJlZCcpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChfLmlzVW5kZWZpbmVkKCRzY29wZS5pdGVtLmVuZCkgfHwgJHNjb3BlLml0ZW0uZW5kID09ICcnKSB7XG4gICAgICAgICAgICBoYXNFcnJvcnMgPSBzaG93RXJyb3IoJ0VuZCByZXF1aXJlZCcpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBoYXNFcnJvcnM7XG4gICAgfVxuXG4gICAgJHNjb3BlLnNhdmUgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgaWYgKCFmb3JtSGFzRXJyb3JzKCkpIHtcbiAgICAgICAgICAgICRRSkFwaS5nZXRDb250cm9sbGVyKCdwcm9qZWN0JykucG9zdCh7XG4gICAgICAgICAgICAgICAgYWN0aW9uOiAnaG91cnNfc2F2ZSdcbiAgICAgICAgICAgIH0sICRzY29wZS5pdGVtLCBmdW5jdGlvbihyZXMpIHtcbiAgICAgICAgICAgICAgICAkUUpMb2dnZXIubG9nKFwiUHJvamVjdEhvdXJzRWRpdENvbnRyb2xsZXIgLT4gLT4gcHJvamVjdCBob3Vyc19zYXZlIC0+IHN1Y2Nlc3NcIik7XG4gICAgICAgICAgICAgICAgLy9cbiAgICAgICAgICAgICAgICBzaG93RXJyb3IoJ0NhbWJpb3MgZ3VhcmRhZG9zJyk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfTtcbiAgICB9O1xuICAgICRzY29wZS5jYW5jZWwgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgJFFKSGVscGVyRnVuY3Rpb25zLmNoYW5nZVN0YXRlKCdtb2R1bGUtcHJvamVjdC1ob3Vycy1saXN0Jyk7XG4gICAgfTtcbiAgICAkc2NvcGUuZGVsZXRlID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciByID0gY29uZmlybShcIkRlbGV0ZSBbXCIgKyAkc2NvcGUuaXRlbS5zdGFydCArIFwiIC0gXCIgKyAkc2NvcGUuaXRlbS5lbmQgKyBcIl0gP1wiKTtcbiAgICAgICAgaWYgKHIgPT0gdHJ1ZSkge1xuICAgICAgICAgICAgJFFKQXBpLmdldENvbnRyb2xsZXIoJ3Byb2plY3QnKS5wb3N0KHtcbiAgICAgICAgICAgICAgICBhY3Rpb246ICdob3Vyc19kZWxldGUnXG4gICAgICAgICAgICB9LCAkc2NvcGUuaXRlbSwgZnVuY3Rpb24ocmVzKSB7XG4gICAgICAgICAgICAgICAgJFFKTG9nZ2VyLmxvZyhcIlByb2plY3RIb3Vyc0VkaXRDb250cm9sbGVyIC0+IHByb2plY3QgZGVsZXRlIC0+IHN1Y2Nlc3NcIik7XG4gICAgICAgICAgICAgICAgLy9cbiAgICAgICAgICAgICAgICBzaG93RXJyb3IoJ0NhbWJpb3MgZ3VhcmRhZG9zJyk7XG4gICAgICAgICAgICAgICAgc2hvd0Vycm9yKCRzY29wZS5pdGVtLm5hbWUgKyAnIGVsaW1pbmFkbycpO1xuXG4gICAgICAgICAgICAgICAgJHRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgICAgICRRSkhlbHBlckZ1bmN0aW9ucy5jaGFuZ2VTdGF0ZSgnbW9kdWxlLXByb2plY3QtaG91cnMtbGlzdCcpO1xuICAgICAgICAgICAgICAgIH0sIDUwMCk7XG5cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9IGVsc2Uge31cbiAgICB9XG5cblxuICAgIGZ1bmN0aW9uIGNyZWF0ZSgpIHtcbiAgICAgICAgJFFKTG9nZ2VyLmxvZyhcIlByb2plY3RIb3Vyc0VkaXRDb250cm9sbGVyIC0+IGNyZWF0ZSBuZXchXCIpO1xuICAgICAgICAkc2NvcGUuaXRlbSA9IHtcbiAgICAgICAgICAgIF9pZDogLTEsXG4gICAgICAgICAgICBfaWRfcHJvamVjdDogJycsXG4gICAgICAgICAgICBfaWRfdXNlcjogJycsXG4gICAgICAgICAgICBzdGFydDogJycsXG4gICAgICAgICAgICBlbmQ6ICcnLFxuICAgICAgICAgICAgbWlsbGlzZWNvbmRzOiAnJyxcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBsb2FkQ29udHJvbHMoKSB7XG5cblxuICAgIH1cblxuICAgIGlmIChfaWQgPT0gLTEpIHtcbiAgICAgICAgLy9DUkVBVEVcbiAgICAgICAgLy9jcmVhdGUoKTtcbiAgICAgICAgbG9hZENvbnRyb2xzKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgLy9VUERBVEVcbiAgICAgICAgJFFKQXBpLmdldENvbnRyb2xsZXIoJ3Byb2plY3QnKS5nZXQoe1xuICAgICAgICAgICAgYWN0aW9uOiAnaG91cnNfc2luZ2xlJyxcbiAgICAgICAgICAgIGlkOiBfaWRcbiAgICAgICAgfSwgZnVuY3Rpb24ocmVzKSB7XG4gICAgICAgICAgICAkUUpMb2dnZXIubG9nKFwiUHJvamVjdEhvdXJzRWRpdENvbnRyb2xsZXIgLT4gcHJvamVjdCBob3Vyc19zaW5nbGUgLT4gc3VjY2Vzc1wiKTtcbiAgICAgICAgICAgIC8vY29uc29sZS5pbmZvKHJlcy5pdGVtKTtcbiAgICAgICAgICAgICRzY29wZS5pdGVtID0gcmVzLml0ZW07XG4gICAgICAgICAgICAkc2NvcGUuYnJlYWRjcnVtYi5hY3RpdmUgPSAkc2NvcGUuaXRlbS51c2VyTmFtZSArIFwiJ3MgVGltZXN0YW1wXCI7XG4gICAgICAgICAgICBsb2FkQ29udHJvbHMoKTtcbiAgICAgICAgfSk7XG5cbiAgICB9XG59KTtcbn0pLmNhbGwodGhpcyxyZXF1aXJlKFwiKzdaSnAwXCIpLHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvLi4vY29udHJvbGxlcnMvbW9kLnByb2plY3Rob3Vyc0N0cmwuanNcIixcIi8uLi9jb250cm9sbGVyc1wiKSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbnZhciBtb2R1bGUgPSByZXF1aXJlKCcuL19tb2R1bGVfaW5pdC5qcycpO1xubW9kdWxlLmNvbnRyb2xsZXIoJ1Byb2plY3RMaXN0Q29udHJvbGxlcicsIGZ1bmN0aW9uKFxuICAgICRRSkNDb21ib2JveCwgJFFKQ1NlbGVjdGtleSwgJFFKQ0xpc3R2aWV3LCAkUUpDRmlsdGVyLCAkUUpMb2dnZXIsICRRSkhlbHBlckZ1bmN0aW9ucywgJHNjb3BlLCAkcm9vdFNjb3BlLCAkUUpMb2dpbk1vZHVsZSwgJFFKQXBpLCAkdGltZW91dCwgJHN0YXRlLCAkUUpMb2dpbk1vZHVsZVxuKSB7XG5cbiAgICAkUUpMb2dnZXIubG9nKFwiUHJvamVjdExpc3RDb250cm9sbGVyIC0+IGluaXRpYWxpemVkXCIpO1xuXG5cbiAgICAkc2NvcGUuYnJlYWRjcnVtYiA9IHtcbiAgICAgICAgbmFtZTogJ1Byb2plY3RzJyxcbiAgICAgICAgbGlzdDogW1xuICAgICAgICAgICAgLy97bmFtZTonTm9uZTInLHN0YXRlOicnLGZhOidmYS1kYXNoYm9hcmQnfVxuICAgICAgICBdLFxuICAgICAgICBhY3RpdmU6IFwiUHJvamVjdHNcIlxuICAgIH07XG5cbiAgICAkc2NvcGUucHJvamVjdHMgPSBbXTsgLy9ob2xkcyBwcm9qZWN0cyBmcm9tIGRiXG4gICAgJHNjb3BlLnByb2plY3RzRGF0YSA9IG51bGw7IC8vaG9sZHMgcHJvamVjdHMgZGl2aWRlZCBwZXIgcGFnZVxuXG4gICAgLy9maWx0ZXJcbiAgICAkUUpDRmlsdGVyLmNyZWF0ZSh7XG4gICAgICAgIG5hbWU6ICdwcm9qZWN0c0ZpbHRlcicsXG4gICAgICAgIGZpZWxkczogW3tcbiAgICAgICAgICAgIG5hbWU6ICduYW1lJyxcbiAgICAgICAgICAgIGFycmF5TmFtZTogJ3Byb2plY3RzJyxcbiAgICAgICAgICAgIGJpbmRUbzogWyduYW1lJ11cbiAgICAgICAgfSwge1xuICAgICAgICAgICAgbmFtZTogJ2Rlc2NyaXB0aW9uJyxcbiAgICAgICAgICAgIGFycmF5TmFtZTogJ3Byb2plY3RzJyxcbiAgICAgICAgICAgIGJpbmRUbzogWydkZXNjcmlwdGlvbiddXG4gICAgICAgIH0sIHtcbiAgICAgICAgICAgIG5hbWU6ICdfaWRfY29tcGFueScsXG4gICAgICAgICAgICBhcnJheU5hbWU6ICdwcm9qZWN0cycsXG4gICAgICAgICAgICBiaW5kVG86IFsnX2lkX2NvbXBhbnknXVxuICAgICAgICB9XVxuICAgIH0sICRzY29wZSk7XG5cblxuICAgIGZ1bmN0aW9uIGxvYWRDb250cm9scygpIHtcbiAgICAgICAgLy9jb21ib2JveFxuICAgICAgICAkUUpDQ29tYm9ib3guY3JlYXRlKHtcbiAgICAgICAgICAgIG5hbWU6ICdjb21wYW55Q0JPJyxcbiAgICAgICAgICAgIGxhYmVsOiBcIkNvbXBhbnlcIixcbiAgICAgICAgICAgIGNvZGU6IC0xLCAvLyRyb290U2NvcGUuY3VycmVudFVzZXIuX2dyb3VwX2lkLFxuICAgICAgICAgICAgY29kZV9jb3B5dG86ICdwcm9qZWN0c0ZpbHRlci5maWVsZHMuX2lkX2NvbXBhbnknLFxuICAgICAgICAgICAgYXBpOiB7XG4gICAgICAgICAgICAgICAgY29udHJvbGxlcjogJ2NvbXBhbnknLFxuICAgICAgICAgICAgICAgIHBhcmFtczoge1xuICAgICAgICAgICAgICAgICAgICBhY3Rpb246ICdjb21ib2JveF9hbGwnXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgfSwgJHNjb3BlKTtcbiAgICAgICAgLy9saXN0dmlld1xuICAgICAgICAkUUpDTGlzdHZpZXcuY3JlYXRlKHtcbiAgICAgICAgICAgIG5hbWU6ICdwcm9qZWN0c0xWVycsXG4gICAgICAgICAgICBkYXRhQXJyYXk6ICdwcm9qZWN0cycsXG4gICAgICAgICAgICBwYWdlZERhdGFBcnJheTogJ3Byb2plY3RzRGF0YScsXG4gICAgICAgICAgICBhcGk6IHtcbiAgICAgICAgICAgICAgICBjb250cm9sbGVyOiAncHJvamVjdCcsXG4gICAgICAgICAgICAgICAgcGFyYW1zOiB7XG4gICAgICAgICAgICAgICAgICAgIGFjdGlvbjogJ2FsbCcsXG4gICAgICAgICAgICAgICAgICAgIF9pZF9jb21wYW55OiAtMVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBjb2x1bW5zOiBbe1xuICAgICAgICAgICAgICAgIG5hbWU6ICduYW1lJyxcbiAgICAgICAgICAgICAgICBsYWJlbDogJ05hbWUnXG4gICAgICAgICAgICB9LCB7XG4gICAgICAgICAgICAgICAgbmFtZTogJ2Rlc2NyaXB0aW9uJyxcbiAgICAgICAgICAgICAgICBsYWJlbDogJ0Rlc2NyaXB0aW9uJ1xuICAgICAgICAgICAgfSwge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdjb21wYW55RGVzY3JpcHRpb24nLFxuICAgICAgICAgICAgICAgIGxhYmVsOiAnQ29tcGFueSdcbiAgICAgICAgICAgIH1dLFxuICAgICAgICAgICAgaXRlbUNsaWNrOiBmdW5jdGlvbihpdGVtKSB7XG4gICAgICAgICAgICAgICAgJFFKSGVscGVyRnVuY3Rpb25zLmNoYW5nZVN0YXRlKCdtb2R1bGUtcHJvamVjdC1lZGl0Jywge1xuICAgICAgICAgICAgICAgICAgICBpZDogaXRlbS5faWRcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSwgJHNjb3BlKTtcbiAgICB9XG5cblxuICAgIC8vTG9hZCBjb250cm9scyB3aGVuIGN1cnJlbnQgdXNlciBpdHMgYXZhbGlhYmxlLlxuICAgIHZhciBjb250cm9sc0xvYWRlZCA9IGZhbHNlO1xuICAgICRyb290U2NvcGUuJG9uKCdjdXJyZW50VXNlci5jaGFuZ2UnLCBmdW5jdGlvbigpIHtcbiAgICAgICAgbG9hZENvbnRyb2xzKCk7XG4gICAgICAgIGNvbnRyb2xzTG9hZGVkID0gdHJ1ZTtcbiAgICB9KTtcbiAgICBpZiAoIWNvbnRyb2xzTG9hZGVkICYmICFfLmlzVW5kZWZpbmVkKCRyb290U2NvcGUuY3VycmVudFVzZXIpKSB7XG4gICAgICAgIGxvYWRDb250cm9scygpO1xuICAgICAgICBjb250cm9sc0xvYWRlZCA9IHRydWU7XG4gICAgfVxuXG4gICAgLy9kZWZhdWx0c1xuICAgICR0aW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgICAkc2NvcGUucHJvamVjdHNGaWx0ZXIuZmlsdGVyKCk7XG4gICAgfSwgMjAwMCk7XG5cbn0pXG5cbm1vZHVsZS5jb250cm9sbGVyKCdQcm9qZWN0RWRpdENvbnRyb2xsZXInLCBmdW5jdGlvbihcbiAgICAkUUpDQ29tYm9ib3gsICRRSkNTZWxlY3RrZXksICRRSkNMaXN0dmlldywgJFFKQ0ZpbHRlciwgJFFKTG9nZ2VyLCAkUUpIZWxwZXJGdW5jdGlvbnMsICRzY29wZSwgJHJvb3RTY29wZSwgJFFKTG9naW5Nb2R1bGUsICRRSkFwaSwgJHRpbWVvdXQsICRzdGF0ZSwgJFFKTG9naW5Nb2R1bGVcbikge1xuXG4gICAgJFFKTG9nZ2VyLmxvZyhcIlByb2plY3RFZGl0Q29udHJvbGxlciAtPiBpbml0aWFsaXplZFwiKTtcblxuICAgICRzY29wZS5icmVhZGNydW1iID0ge1xuICAgICAgICBuYW1lOiAnUHJvamVjdCcsXG4gICAgICAgIGxpc3Q6IFt7XG4gICAgICAgICAgICBuYW1lOiAnUHJvamVjdHMnLFxuICAgICAgICAgICAgc3RhdGU6ICdtb2R1bGUtcHJvamVjdC1saXN0JyxcbiAgICAgICAgICAgIC8vZmE6ICdmYS1kYXNoYm9hcmQnXG4gICAgICAgIH1dLFxuICAgICAgICBhY3RpdmU6ICdMb2FkaW5nLi4uJ1xuICAgIH07XG5cblxuICAgIHZhciBfcHJvamVjdF9pZCA9ICRzdGF0ZS5wYXJhbXMuaWQ7XG5cbiAgICAkc2NvcGUuY3J1ZCA9IHtcbiAgICAgICAgZXJyb3JzOiBbXVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNob3dFcnJvcihlcnJvcikge1xuICAgICAgICAkc2NvcGUuY3J1ZC5lcnJvcnMucHVzaChlcnJvcik7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGZvcm1IYXNFcnJvcnMoKSB7XG4gICAgICAgICRzY29wZS5jcnVkLmVycm9ycyA9IFtdO1xuICAgICAgICB2YXIgaGFzRXJyb3JzID0gZmFsc2U7XG4gICAgICAgIGlmIChfLmlzVW5kZWZpbmVkKCRzY29wZS5pdGVtLm5hbWUpIHx8ICRzY29wZS5pdGVtLm5hbWUgPT0gJycpIHtcbiAgICAgICAgICAgIGhhc0Vycm9ycyA9IHNob3dFcnJvcignTmFtZSByZXF1aXJlZCcpO1xuICAgICAgICB9XG4gICAgICAgIC8qXG4gICAgICAgIGlmIChfLmlzVW5kZWZpbmVkKCRzY29wZS5pdGVtLmRlc2NyaXB0aW9uKSB8fCAkc2NvcGUuaXRlbS5kZXNjcmlwdGlvbiA9PSAnJykge1xuICAgICAgICAgICAgaGFzRXJyb3JzID0gc2hvd0Vycm9yKCdGaXJzdCBuYW1lIHJlcXVpcmVkJyk7XG4gICAgICAgIH1cbiAgICAgICAgKi9cbiAgICAgICAgaWYgKF8uaXNVbmRlZmluZWQoJHNjb3BlLml0ZW0uX2lkX2NvbXBhbnkpIHx8ICRzY29wZS5pdGVtLl9pZF9jb21wYW55ID09ICcnKSB7XG4gICAgICAgICAgICBoYXNFcnJvcnMgPSBzaG93RXJyb3IoJ0NvbXBhbnkgcmVxdWlyZWQnKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gaGFzRXJyb3JzO1xuICAgIH1cblxuICAgICRzY29wZS5zYXZlID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIGlmICghZm9ybUhhc0Vycm9ycygpKSB7XG4gICAgICAgICAgICAkUUpBcGkuZ2V0Q29udHJvbGxlcigncHJvamVjdCcpLnBvc3Qoe1xuICAgICAgICAgICAgICAgIGFjdGlvbjogJ3NhdmUnXG4gICAgICAgICAgICB9LCAkc2NvcGUuaXRlbSwgZnVuY3Rpb24ocmVzKSB7XG4gICAgICAgICAgICAgICAgJFFKTG9nZ2VyLmxvZyhcIlByb2plY3RFZGl0Q29udHJvbGxlciAtPiAtPiBwcm9qZWN0IHNhdmUgLT4gc3VjY2Vzc1wiKTtcbiAgICAgICAgICAgICAgICAvL1xuICAgICAgICAgICAgICAgIHNob3dFcnJvcignQ2FtYmlvcyBndWFyZGFkb3MnKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9O1xuICAgIH07XG4gICAgJHNjb3BlLmNhbmNlbCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAkUUpIZWxwZXJGdW5jdGlvbnMuY2hhbmdlU3RhdGUoJ21vZHVsZS1wcm9qZWN0LWxpc3QnKTtcbiAgICB9O1xuICAgICRzY29wZS5kZWxldGUgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIHIgPSBjb25maXJtKFwiRGVsZXRlIFwiICsgJHNjb3BlLml0ZW0ubmFtZSArIFwiID9cIik7XG4gICAgICAgIGlmIChyID09IHRydWUpIHtcbiAgICAgICAgICAgICRRSkFwaS5nZXRDb250cm9sbGVyKCdwcm9qZWN0JykucG9zdCh7XG4gICAgICAgICAgICAgICAgYWN0aW9uOiAnZGVsZXRlJ1xuICAgICAgICAgICAgfSwgJHNjb3BlLml0ZW0sIGZ1bmN0aW9uKHJlcykge1xuICAgICAgICAgICAgICAgICRRSkxvZ2dlci5sb2coXCJQcm9qZWN0RWRpdENvbnRyb2xsZXIgLT4gcHJvamVjdCBkZWxldGUgLT4gc3VjY2Vzc1wiKTtcbiAgICAgICAgICAgICAgICAvL1xuICAgICAgICAgICAgICAgIHNob3dFcnJvcignQ2FtYmlvcyBndWFyZGFkb3MnKTtcbiAgICAgICAgICAgICAgICBzaG93RXJyb3IoJHNjb3BlLml0ZW0ubmFtZSArICcgZWxpbWluYWRvJyk7XG5cbiAgICAgICAgICAgICAgICAkdGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICAgICAgJFFKSGVscGVyRnVuY3Rpb25zLmNoYW5nZVN0YXRlKCdtb2R1bGUtcHJvamVjdC1saXN0Jyk7XG4gICAgICAgICAgICAgICAgfSwgNTAwKTtcblxuICAgICAgICAgICAgICAgIGNyZWF0ZSgpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSB7fVxuICAgIH1cblxuXG4gICAgZnVuY3Rpb24gY3JlYXRlKCkge1xuICAgICAgICAkUUpMb2dnZXIubG9nKFwiUHJvamVjdEVkaXRDb250cm9sbGVyIC0+IGNyZWF0ZSBuZXchXCIpO1xuICAgICAgICAkc2NvcGUuaXRlbSA9IHtcbiAgICAgICAgICAgIG5hbWU6ICcnLFxuICAgICAgICAgICAgZGVzY3JpcHRpb246ICcnLFxuICAgICAgICAgICAgX2lkX2NvbXBhbnk6ICcnLFxuICAgICAgICAgICAgX2lkOiAtMVxuICAgICAgICB9O1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGxvYWRDb250cm9scygpIHtcbiAgICAgICAgLy9jb21ib2JveFxuICAgICAgICAkUUpDQ29tYm9ib3guY3JlYXRlKHtcbiAgICAgICAgICAgIG5hbWU6ICdjb21wYW55Q0JPJyxcbiAgICAgICAgICAgIGxhYmVsOiBcIkNvbXBhbnlcIixcbiAgICAgICAgICAgIGNvZGU6ICRzY29wZS5pdGVtLl9pZF9jb21wYW55LFxuICAgICAgICAgICAgY29kZV9jb3B5dG86ICdpdGVtLl9pZF9jb21wYW55JyxcbiAgICAgICAgICAgIGFwaToge1xuICAgICAgICAgICAgICAgIGNvbnRyb2xsZXI6ICdjb21wYW55JyxcbiAgICAgICAgICAgICAgICBwYXJhbXM6IHtcbiAgICAgICAgICAgICAgICAgICAgYWN0aW9uOiAnY29tYm9ib3hfYWxsJ1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgIH0sICRzY29wZSk7XG4gICAgfVxuXG4gICAgaWYgKF9wcm9qZWN0X2lkID09IC0xKSB7XG4gICAgICAgIC8vQ1JFQVRFXG4gICAgICAgIGNyZWF0ZSgpO1xuICAgICAgICBsb2FkQ29udHJvbHMoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICAvL1VQREFURVxuICAgICAgICAkUUpBcGkuZ2V0Q29udHJvbGxlcigncHJvamVjdCcpLmdldCh7XG4gICAgICAgICAgICBhY3Rpb246ICdzaW5nbGUnLFxuICAgICAgICAgICAgaWQ6IF9wcm9qZWN0X2lkXG4gICAgICAgIH0sIGZ1bmN0aW9uKHJlcykge1xuICAgICAgICAgICAgJFFKTG9nZ2VyLmxvZyhcIlByb2plY3RFZGl0Q29udHJvbGxlciAtPiBwcm9qZWN0IHNpbmdsZSAtPiBzdWNjZXNzXCIpO1xuICAgICAgICAgICAgY29uc29sZS5pbmZvKHJlcy5pdGVtKTtcbiAgICAgICAgICAgICRzY29wZS5pdGVtID0gcmVzLml0ZW07XG5cbiAgICAgICAgICAgICRzY29wZS5icmVhZGNydW1iLmFjdGl2ZSA9ICRzY29wZS5pdGVtLm5hbWU7XG5cbiAgICAgICAgICAgIGxvYWRDb250cm9scygpO1xuICAgICAgICB9KTtcblxuICAgIH1cblxufSk7XG5cblxuO1xufSkuY2FsbCh0aGlzLHJlcXVpcmUoXCIrN1pKcDBcIiksdHlwZW9mIHNlbGYgIT09IFwidW5kZWZpbmVkXCIgPyBzZWxmIDogdHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiA/IHdpbmRvdyA6IHt9LHJlcXVpcmUoXCJidWZmZXJcIikuQnVmZmVyLGFyZ3VtZW50c1szXSxhcmd1bWVudHNbNF0sYXJndW1lbnRzWzVdLGFyZ3VtZW50c1s2XSxcIi8uLi9jb250cm9sbGVycy9tb2QucHJvamVjdHNDdHJsLmpzXCIsXCIvLi4vY29udHJvbGxlcnNcIikiLCIoZnVuY3Rpb24gKHByb2Nlc3MsZ2xvYmFsLEJ1ZmZlcixfX2FyZ3VtZW50MCxfX2FyZ3VtZW50MSxfX2FyZ3VtZW50MixfX2FyZ3VtZW50MyxfX2ZpbGVuYW1lLF9fZGlybmFtZSl7XG52YXIgbW9kdWxlID0gcmVxdWlyZSgnLi9fbW9kdWxlX2luaXQuanMnKTtcbm1vZHVsZS5jb250cm9sbGVyKCdVc2VyZ3JvdXBMaXN0Q29udHJvbGxlcicsIGZ1bmN0aW9uKFxuXHQkUUpDQ29tYm9ib3gsICRRSkNTZWxlY3RrZXksICRRSkNMaXN0dmlldywgJFFKQ0ZpbHRlciwgJFFKTG9nZ2VyLCAkUUpIZWxwZXJGdW5jdGlvbnMsICRzY29wZSwgJHJvb3RTY29wZSwgJFFKTG9naW5Nb2R1bGUsICRRSkFwaSwgJHRpbWVvdXQsICRzdGF0ZSwgJFFKTG9naW5Nb2R1bGVcbikge1xuXG5cdCRRSkxvZ2dlci5sb2coXCJVc2VyZ3JvdXBMaXN0Q29udHJvbGxlciAtPiBpbml0aWFsaXplZFwiKTtcblx0JHNjb3BlLmJyZWFkY3J1bWIgPSB7XG5cdFx0bmFtZTogJ1VzZXJncm91cHMnLFxuXHRcdGxpc3Q6IFtdLFxuXHRcdGFjdGl2ZTogXCJVc2VyZ3JvdXBzXCJcblx0fTtcblx0JHNjb3BlLml0ZW1zID0gW107IC8vaG9sZHMgaXRlbXMgZnJvbSBkYlxuXHQkc2NvcGUubHZ3RGF0YSA9IG51bGw7IC8vaG9sZHMgaXRlbXMgZGl2aWRlZCBwZXIgcGFnZVxuXG5cdC8vZmlsdGVyXG5cdCRRSkNGaWx0ZXIuY3JlYXRlKHtcblx0XHRuYW1lOiAnZmlsdGVyJyxcblx0XHRmaWVsZHM6IFt7XG5cdFx0XHRuYW1lOiAnZGVzY3JpcHRpb24nLFxuXHRcdFx0YXJyYXlOYW1lOiAnaXRlbXMnLFxuXHRcdFx0YmluZFRvOiBbJ2Rlc2NyaXB0aW9uJ11cblx0XHR9LCB7XG5cdFx0XHRuYW1lOiAnX2lkX3Byb2ZpbGUnLFxuXHRcdFx0YXJyYXlOYW1lOiAnaXRlbXMnLFxuXHRcdFx0YmluZFRvOiBbJ19pZF9wcm9maWxlJ11cblx0XHR9XVxuXHR9LCAkc2NvcGUpO1xuXG5cdGZ1bmN0aW9uIGxvYWRDb250cm9scygpIHtcblx0XHQvL2NvbWJvYm94XG5cdFx0JFFKQ0NvbWJvYm94LmNyZWF0ZSh7XG5cdFx0XHRuYW1lOiAncHJvZmlsZUNCTycsXG5cdFx0XHRsYWJlbDogXCJQcm9maWxlXCIsXG5cdFx0XHRjb2RlOiAtMSxcblx0XHRcdGNvZGVfY29weXRvOiAnZmlsdGVyLmZpZWxkcy5faWRfcHJvZmlsZScsXG5cdFx0XHRhcGk6IHtcblx0XHRcdFx0Y29udHJvbGxlcjogJ3Byb2ZpbGUnLFxuXHRcdFx0XHRwYXJhbXM6IHtcblx0XHRcdFx0XHRhY3Rpb246ICdjb21ib2JveF9hbGwnXG5cdFx0XHRcdH1cblx0XHRcdH0sXG5cdFx0fSwgJHNjb3BlKTtcblx0XHQvL2xpc3R2aWV3XG5cdFx0JFFKQ0xpc3R2aWV3LmNyZWF0ZSh7XG5cdFx0XHRuYW1lOiAnbHZ3Jyxcblx0XHRcdGRhdGFBcnJheTogJ2l0ZW1zJyxcblx0XHRcdHBhZ2VkRGF0YUFycmF5OiAnbHZ3RGF0YScsXG5cdFx0XHRhcGk6IHtcblx0XHRcdFx0Y29udHJvbGxlcjogJ3VzZXJncm91cCcsXG5cdFx0XHRcdHBhcmFtczoge1xuXHRcdFx0XHRcdGFjdGlvbjogJ2x2d2RhdGEnXG5cdFx0XHRcdH1cblx0XHRcdH0sXG5cdFx0XHRjb2x1bW5zOiBbe1xuXHRcdFx0XHRuYW1lOiAnZGVzY3JpcHRpb24nLFxuXHRcdFx0XHRsYWJlbDogJ0Rlc2NyaXB0aW9uJ1xuXHRcdFx0fSwge1xuXHRcdFx0XHRuYW1lOiAncHJvZmlsZURlc2NyaXB0aW9uJyxcblx0XHRcdFx0bGFiZWw6ICdQcm9maWxlJ1xuXHRcdFx0fV0sXG5cdFx0XHRpdGVtQ2xpY2s6IGZ1bmN0aW9uKGl0ZW0pIHtcblx0XHRcdFx0JFFKSGVscGVyRnVuY3Rpb25zLmNoYW5nZVN0YXRlKCdtb2R1bGUtdXNlcmdyb3VwLWVkaXQnLCB7XG5cdFx0XHRcdFx0aWQ6IGl0ZW0uX2lkXG5cdFx0XHRcdH0pO1xuXHRcdFx0fVxuXHRcdH0sICRzY29wZSk7XG5cdH1cblxuXG5cdC8vTG9hZCBjb250cm9scyB3aGVuIGN1cnJlbnQgaXRlbSBpdHMgYXZhbGlhYmxlLlxuXHR2YXIgY29udHJvbHNMb2FkZWQgPSBmYWxzZTtcblx0JHJvb3RTY29wZS4kb24oJ2N1cnJlbnRVc2VyLmNoYW5nZScsIGZ1bmN0aW9uKCkge1xuXHRcdGxvYWRDb250cm9scygpO1xuXHRcdGNvbnRyb2xzTG9hZGVkID0gdHJ1ZTtcblx0fSk7XG5cdGlmICghY29udHJvbHNMb2FkZWQgJiYgIV8uaXNVbmRlZmluZWQoJHJvb3RTY29wZS5jdXJyZW50VXNlcikpIHtcblx0XHRsb2FkQ29udHJvbHMoKTtcblx0XHRjb250cm9sc0xvYWRlZCA9IHRydWU7XG5cdH1cblx0Ly9kZWZhdWx0c1xuXHQkdGltZW91dChmdW5jdGlvbigpIHtcblx0XHQkc2NvcGUuZmlsdGVyLmZpbHRlcigpO1xuXHR9LCAyMDAwKTtcbn0pXG5cbm1vZHVsZS5jb250cm9sbGVyKCdVc2VyZ3JvdXBFZGl0Q29udHJvbGxlcicsIGZ1bmN0aW9uKFxuXHQkUUpDQ29tYm9ib3gsICRRSkNTZWxlY3RrZXksICRRSkNMaXN0dmlldywgJFFKQ0ZpbHRlciwgJFFKTG9nZ2VyLCAkUUpIZWxwZXJGdW5jdGlvbnMsICRzY29wZSwgJHJvb3RTY29wZSwgJFFKTG9naW5Nb2R1bGUsICRRSkFwaSwgJHRpbWVvdXQsICRzdGF0ZSwgJFFKTG9naW5Nb2R1bGVcbikge1xuXG5cdCRRSkxvZ2dlci5sb2coXCJVc2VyZ3JvdXBFZGl0Q29udHJvbGxlciAtPiBpbml0aWFsaXplZFwiKTtcblx0JHNjb3BlLmJyZWFkY3J1bWIgPSB7XG5cdFx0bmFtZTogJ1VzZXJncm91cCBFZGl0Jyxcblx0XHRsaXN0OiBbe1xuXHRcdFx0bmFtZTogXCJVc2VyZ3JvdXBzXCIsXG5cdFx0XHRzdGF0ZTogJ21vZHVsZS11c2VyZ3JvdXAtbGlzdCcsXG5cdFx0XHQvL2ZhOiAnZmEtZGFzaGJvYXJkJ1xuXHRcdH0sIF0sXG5cdFx0YWN0aXZlOiBcIkxvYWRpbmcuLi5cIlxuXHR9O1xuXG5cblxuXHR2YXIgX2lkID0gJHN0YXRlLnBhcmFtcy5pZDtcblxuXHQkc2NvcGUuY3J1ZCA9IHtcblx0XHRlcnJvcnM6IFtdXG5cdH1cblxuXHRmdW5jdGlvbiBzaG93RXJyb3IoZXJyb3IpIHtcblx0XHQkc2NvcGUuY3J1ZC5lcnJvcnMucHVzaChlcnJvcik7XG5cdFx0cmV0dXJuIHRydWU7XG5cdH1cblxuXHRmdW5jdGlvbiBmb3JtSGFzRXJyb3JzKCkge1xuXHRcdCRzY29wZS5jcnVkLmVycm9ycyA9IFtdO1xuXHRcdHZhciBoYXNFcnJvcnMgPSBmYWxzZTtcblx0XHRpZiAoXy5pc1VuZGVmaW5lZCgkc2NvcGUuaXRlbS5kZXNjcmlwdGlvbikgfHwgJHNjb3BlLml0ZW0uZGVzY3JpcHRpb24gPT0gJycpIHtcblx0XHRcdGhhc0Vycm9ycyA9IHNob3dFcnJvcignRGVzY3JpcHRpb24gcmVxdWlyZWQnKTtcblx0XHR9XG5cdFx0aWYgKF8uaXNVbmRlZmluZWQoJHNjb3BlLml0ZW0uX2lkX3Byb2ZpbGUpIHx8ICRzY29wZS5pdGVtLl9pZF9wcm9maWxlID09ICcnKSB7XG5cdFx0XHRoYXNFcnJvcnMgPSBzaG93RXJyb3IoJ1Byb2ZpbGUgcmVxdWlyZWQnKTtcblx0XHR9XG5cdFx0cmV0dXJuIGhhc0Vycm9ycztcblx0fVxuXG5cdCRzY29wZS5zYXZlID0gZnVuY3Rpb24oKSB7XG5cdFx0aWYgKCFmb3JtSGFzRXJyb3JzKCkpIHtcblx0XHRcdCRRSkFwaS5nZXRDb250cm9sbGVyKCd1c2VyZ3JvdXAnKS5wb3N0KHtcblx0XHRcdFx0YWN0aW9uOiAnc2F2ZSdcblx0XHRcdH0sICRzY29wZS5pdGVtLCBmdW5jdGlvbihyZXMpIHtcblx0XHRcdFx0JFFKTG9nZ2VyLmxvZyhcIlVzZXJncm91cEVkaXRDb250cm9sbGVyIC0+IGFwaSBwb3N0IC0+IHNhdmUgLT4gc3VjY2Vzc1wiKTtcblx0XHRcdFx0Ly9cblx0XHRcdFx0c2hvd0Vycm9yKCdDYW1iaW9zIGd1YXJkYWRvcycpO1xuXHRcdFx0XHQkUUpIZWxwZXJGdW5jdGlvbnMuY2hhbmdlU3RhdGUoJ21vZHVsZS11c2VyZ3JvdXAtbGlzdCcsIHt9LCA1MDApO1xuXHRcdFx0fSk7XG5cdFx0fTtcblx0fTtcblx0JHNjb3BlLmRlbGV0ZSA9IGZ1bmN0aW9uKCkge1xuXHRcdHZhciByID0gY29uZmlybShcIkRlbGV0ZSBcIiArICRzY29wZS5pdGVtLm5hbWUgKyBcIiA/XCIpO1xuXHRcdGlmIChyID09IHRydWUpIHtcblx0XHRcdCRRSkFwaS5nZXRDb250cm9sbGVyKCd1c2VyZ3JvdXAnKS5wb3N0KHtcblx0XHRcdFx0YWN0aW9uOiAnZGVsZXRlJ1xuXHRcdFx0fSwgJHNjb3BlLml0ZW0sIGZ1bmN0aW9uKHJlcykge1xuXHRcdFx0XHQkUUpMb2dnZXIubG9nKFwiVXNlcmdyb3VwRWRpdENvbnRyb2xsZXIgLT4gZGVsZXRlIC0+IHN1Y2Nlc3NcIik7XG5cdFx0XHRcdC8vXG5cdFx0XHRcdHNob3dFcnJvcignQ2FtYmlvcyBndWFyZGFkb3MnKTtcblx0XHRcdFx0c2hvd0Vycm9yKCRzY29wZS5pdGVtLmRlc2NyaXB0aW9uICsgJyBlbGltaW5hZG8nKTtcblx0XHRcdFx0Ly9cblx0XHRcdFx0JFFKSGVscGVyRnVuY3Rpb25zLmNoYW5nZVN0YXRlKCdtb2R1bGUtdXNlcmdyb3VwLWxpc3QnLCB7fSwgNTAwKTtcblxuXHRcdFx0XHRjcmVhdGUoKTtcblx0XHRcdH0pO1xuXHRcdH0gZWxzZSB7fVxuXHR9XG5cdCRzY29wZS5jYW5jZWwgPSBmdW5jdGlvbigpIHtcblx0XHQkUUpIZWxwZXJGdW5jdGlvbnMuY2hhbmdlU3RhdGUoJ21vZHVsZS11c2VyZ3JvdXAtbGlzdCcpO1xuXHR9O1xuXG5cdGZ1bmN0aW9uIGxvYWRDb250cm9scygpIHtcblxuXHRcdC8vY29tYm9ib3hcblx0XHQkUUpDQ29tYm9ib3guY3JlYXRlKHtcblx0XHRcdG5hbWU6ICdwcm9maWxlQ0JPJyxcblx0XHRcdGxhYmVsOiBcIlByb2ZpbGVcIixcblx0XHRcdGNvZGU6ICRzY29wZS5pdGVtLl9pZF9wcm9maWxlLFxuXHRcdFx0Y29kZV9jb3B5dG86ICdpdGVtLl9pZF9wcm9maWxlJyxcblx0XHRcdGFwaToge1xuXHRcdFx0XHRjb250cm9sbGVyOiAncHJvZmlsZScsXG5cdFx0XHRcdHBhcmFtczoge1xuXHRcdFx0XHRcdGFjdGlvbjogJ2NvbWJvYm94X2FsbCdcblx0XHRcdFx0fVxuXHRcdFx0fSxcblx0XHR9LCAkc2NvcGUpO1xuXG5cdH1cblxuXHRmdW5jdGlvbiBjcmVhdGUoKSB7XG5cdFx0JFFKTG9nZ2VyLmxvZyhcIlVzZXJncm91cEVkaXRDb250cm9sbGVyIC0+IGNyZWF0ZSBuZXchXCIpO1xuXHRcdCRzY29wZS5pdGVtID0ge1xuXHRcdFx0ZGVzY3JpcHRpb246ICcnLFxuXHRcdFx0X2lkX3Byb2ZpbGU6ICcnLFxuXHRcdFx0X2lkOiAtMVxuXHRcdH07XG5cdH1cblx0aWYgKF9pZCA9PSAtMSkge1xuXHRcdC8vQ1JFQVRFXG5cdFx0Y3JlYXRlKCk7XG5cdFx0bG9hZENvbnRyb2xzKCk7XG5cdH0gZWxzZSB7XG5cdFx0Ly9HRVQgU0lOR0xFIFVTRVJcblx0XHQkUUpBcGkuZ2V0Q29udHJvbGxlcigndXNlcmdyb3VwJykuZ2V0KHtcblx0XHRcdGFjdGlvbjogJ3NpbmdsZScsXG5cdFx0XHRpZDogX2lkXG5cdFx0fSwgZnVuY3Rpb24ocmVzKSB7XG5cdFx0XHQkUUpMb2dnZXIubG9nKFwiVXNlcmdyb3VwRWRpdENvbnRyb2xsZXIgLT4gYXBpIGdldCAtPiBzaW5nbGUgLT4gc3VjY2Vzc1wiKTtcblx0XHRcdCRzY29wZS5pdGVtID0gcmVzLml0ZW07XG5cdFx0XHQkc2NvcGUuYnJlYWRjcnVtYi5hY3RpdmUgPSAkc2NvcGUuaXRlbS5kZXNjcmlwdGlvbjtcblx0XHRcdGxvYWRDb250cm9scygpO1xuXHRcdH0pO1xuXHR9XG5cbn0pO1xuXG47XG59KS5jYWxsKHRoaXMscmVxdWlyZShcIis3WkpwMFwiKSx0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30scmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIsYXJndW1lbnRzWzNdLGFyZ3VtZW50c1s0XSxhcmd1bWVudHNbNV0sYXJndW1lbnRzWzZdLFwiLy4uL2NvbnRyb2xsZXJzL21vZC51c2VyZ3JvdXBDdHJsLmpzXCIsXCIvLi4vY29udHJvbGxlcnNcIikiLCIoZnVuY3Rpb24gKHByb2Nlc3MsZ2xvYmFsLEJ1ZmZlcixfX2FyZ3VtZW50MCxfX2FyZ3VtZW50MSxfX2FyZ3VtZW50MixfX2FyZ3VtZW50MyxfX2ZpbGVuYW1lLF9fZGlybmFtZSl7XG52YXIgbW9kdWxlID0gcmVxdWlyZSgnLi9fbW9kdWxlX2luaXQuanMnKTtcbm1vZHVsZS5jb250cm9sbGVyKCdVc2VyTGlzdENvbnRyb2xsZXInLCBmdW5jdGlvbihcbiAgICAkUUpDQ29tYm9ib3gsICRRSkNTZWxlY3RrZXksICRRSkNMaXN0dmlldywgJFFKQ0ZpbHRlciwgJFFKTG9nZ2VyLCAkUUpIZWxwZXJGdW5jdGlvbnMsICRzY29wZSwgJHJvb3RTY29wZSwgJFFKTG9naW5Nb2R1bGUsICRRSkFwaSwgJHRpbWVvdXQsICRzdGF0ZSwgJFFKTG9naW5Nb2R1bGVcbikge1xuXG5cblxuICAgICRRSkxvZ2dlci5sb2coXCJVc2VyTGlzdENvbnRyb2xsZXIgLT4gaW5pdGlhbGl6ZWRcIik7XG5cblxuXG4gICAgJHNjb3BlLmJyZWFkY3J1bWIgPSB7XG4gICAgICAgIG5hbWU6ICdVc2VycycsXG4gICAgICAgIGxpc3Q6IFtcbiAgICAgICAgICAgIC8ve25hbWU6XCJOb25lMVwiLHN0YXRlOidtb2R1bGUtcHJvamVjdC1saXN0JyxmYTonZmEtZGFzaGJvYXJkJ30sXG4gICAgICAgICAgICAvL3tuYW1lOidOb25lMicsc3RhdGU6JycsZmE6J2ZhLWRhc2hib2FyZCd9XG4gICAgICAgIF0sXG4gICAgICAgIGFjdGl2ZTogXCJVc2Vyc1wiXG4gICAgfTtcblxuXG4gICAgLy9jb25zb2xlLmluZm8oJHJvb3RTY29wZS5jb25maWcpO1xuXG4gICAgJHNjb3BlLnVzZXJzID0gW107IC8vaG9sZHMgdXNlcnMgZnJvbSBkYlxuICAgICRzY29wZS51c2Vyc0RhdGEgPSBudWxsOyAvL2hvbGRzIHVzZXJzIGRpdmlkZWQgcGVyIHBhZ2VcblxuICAgIC8vZmlsdGVyXG4gICAgJFFKQ0ZpbHRlci5jcmVhdGUoe1xuICAgICAgICBuYW1lOiAndXNlcnNGaWx0ZXInLFxuICAgICAgICBmaWVsZHM6IFt7XG4gICAgICAgICAgICBuYW1lOiAnbG9naW5uYW1lJyxcbiAgICAgICAgICAgIGFycmF5TmFtZTogJ3VzZXJzJyxcbiAgICAgICAgICAgIGJpbmRUbzogWydsb2dpbm5hbWUnXVxuICAgICAgICB9LCB7XG4gICAgICAgICAgICBuYW1lOiAndGV4dCcsXG4gICAgICAgICAgICBhcnJheU5hbWU6ICd1c2VycycsXG4gICAgICAgICAgICBiaW5kVG86IFsnZmlyc3RfbmFtZScsICdsYXN0X25hbWUnXVxuICAgICAgICB9LCB7XG4gICAgICAgICAgICBuYW1lOiAnX3VzZXJncm91cF9pZCcsXG4gICAgICAgICAgICBhcnJheU5hbWU6ICd1c2VycycsXG4gICAgICAgICAgICBiaW5kVG86IFsnX3VzZXJncm91cF9pZCddXG4gICAgICAgIH1dXG4gICAgfSwgJHNjb3BlKTtcblxuICAgIC8qXG4gICAgLy9zZWxlY3RrZXlcbiAgICAkUUpDU2VsZWN0a2V5LmNyZWF0ZSh7XG4gICAgICAgIG5hbWU6ICd1c2Vyc1VzZXJncm91cFNMSycsXG4gICAgICAgIGxhYmVsOiBcIlVzZXJncm91cFwiLFxuICAgICAgICBjb2RlOiA3LFxuICAgICAgICB0ZXh0OiBcIk5vIGRpc3BvbmlibGVcIixcbiAgICAgICAgY29kZV9jb3B5dG86ICd1c2Vyc0ZpbHRlci5maWVsZHMuX3VzZXJncm91cF9pZCcsXG4gICAgICAgIHNlYXJjaDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICBjb25zb2xlLmluZm8oJ2dydXBvIGRlIHVzdWFyaW8gbGljaycpXG4gICAgICAgIH1cbiAgICB9LCAkc2NvcGUpO1xuKi9cblxuICAgIGZ1bmN0aW9uIGxvYWRDb250cm9scygpIHtcblxuXG4gICAgICAgIC8vY29tYm9ib3hcbiAgICAgICAgJFFKQ0NvbWJvYm94LmNyZWF0ZSh7XG4gICAgICAgICAgICBuYW1lOiAndXNlcnNVc2VyZ3JvdXBDQk8nLFxuICAgICAgICAgICAgbGFiZWw6IFwiVXNlcmdyb3VwXCIsXG4gICAgICAgICAgICBjb2RlOiAtMSwgLy8kcm9vdFNjb3BlLmN1cnJlbnRVc2VyLl9ncm91cF9pZCxcbiAgICAgICAgICAgIGNvZGVfY29weXRvOiAndXNlcnNGaWx0ZXIuZmllbGRzLl91c2VyZ3JvdXBfaWQnLFxuICAgICAgICAgICAgYXBpOiB7XG4gICAgICAgICAgICAgICAgY29udHJvbGxlcjogJ3VzZXJncm91cCcsXG4gICAgICAgICAgICAgICAgcGFyYW1zOiB7XG4gICAgICAgICAgICAgICAgICAgIGFjdGlvbjogJ2NvbWJvYm94J1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgIH0sICRzY29wZSk7XG4gICAgICAgIC8vbGlzdHZpZXdcbiAgICAgICAgJFFKQ0xpc3R2aWV3LmNyZWF0ZSh7XG4gICAgICAgICAgICBuYW1lOiAndXNlcnNMVlcnLFxuICAgICAgICAgICAgZGF0YUFycmF5OiAndXNlcnMnLFxuICAgICAgICAgICAgcGFnZWREYXRhQXJyYXk6ICd1c2Vyc0RhdGEnLFxuICAgICAgICAgICAgYXBpOiB7XG4gICAgICAgICAgICAgICAgY29udHJvbGxlcjogJ3VzZXInLFxuICAgICAgICAgICAgICAgIHBhcmFtczoge1xuICAgICAgICAgICAgICAgICAgICBhY3Rpb246ICdhbGwnXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGNvbHVtbnM6IFt7XG4gICAgICAgICAgICAgICAgbmFtZTogJ2xvZ2lubmFtZScsXG4gICAgICAgICAgICAgICAgbGFiZWw6ICdVc2VybmFtZSdcbiAgICAgICAgICAgIH0sIHtcbiAgICAgICAgICAgICAgICBuYW1lOiAnZmlyc3RfbmFtZScsXG4gICAgICAgICAgICAgICAgbGFiZWw6ICdGaXJzdCBuYW1lJ1xuICAgICAgICAgICAgfSwge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdsYXN0X25hbWUnLFxuICAgICAgICAgICAgICAgIGxhYmVsOiAnTGFzdCBuYW1lJ1xuICAgICAgICAgICAgfV0sXG4gICAgICAgICAgICBpdGVtQ2xpY2s6IGZ1bmN0aW9uKGl0ZW0pIHtcbiAgICAgICAgICAgICAgICAkUUpIZWxwZXJGdW5jdGlvbnMuY2hhbmdlU3RhdGUoJ21vZHVsZS11c2VyLWVkaXQnLCB7XG4gICAgICAgICAgICAgICAgICAgIGlkOiBpdGVtLl9pZFxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LCAkc2NvcGUpO1xuICAgIH1cblxuXG4gICAgLy9Mb2FkIGNvbnRyb2xzIHdoZW4gY3VycmVudCB1c2VyIGl0cyBhdmFsaWFibGUuXG4gICAgdmFyIGNvbnRyb2xzTG9hZGVkID0gZmFsc2U7XG4gICAgJHJvb3RTY29wZS4kb24oJ2N1cnJlbnRVc2VyLmNoYW5nZScsIGZ1bmN0aW9uKCkge1xuICAgICAgICBsb2FkQ29udHJvbHMoKTtcbiAgICAgICAgY29udHJvbHNMb2FkZWQgPSB0cnVlO1xuICAgIH0pO1xuICAgIGlmICghY29udHJvbHNMb2FkZWQgJiYgIV8uaXNVbmRlZmluZWQoJHJvb3RTY29wZS5jdXJyZW50VXNlcikpIHtcbiAgICAgICAgbG9hZENvbnRyb2xzKCk7XG4gICAgICAgIGNvbnRyb2xzTG9hZGVkID0gdHJ1ZTtcbiAgICB9XG5cblxuICAgIC8vZGVmYXVsdHNcbiAgICAkdGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgJHNjb3BlLnVzZXJzRmlsdGVyLmZpbHRlcigpO1xuICAgIH0sIDIwMDApO1xufSlcblxuXG5cbm1vZHVsZS5jb250cm9sbGVyKCdVc2VyRWRpdENvbnRyb2xsZXInLCBmdW5jdGlvbihcbiAgICAkUUpDQ29tYm9ib3gsICRRSkxvZ2dlciwgJFFKSGVscGVyRnVuY3Rpb25zLCAkc2NvcGUsICRyb290U2NvcGUsICRRSkxvZ2luTW9kdWxlLCAkUUpBcGksICR0aW1lb3V0LCAkc3RhdGUsICRRSkxvZ2luTW9kdWxlXG4pIHtcbiAgICAkUUpMb2dnZXIubG9nKFwiVXNlckVkaXRDb250cm9sbGVyIC0+IGluaXRpYWxpemVkXCIpO1xuXG5cbiAgICAkc2NvcGUuYnJlYWRjcnVtYiA9IHtcbiAgICAgICAgbmFtZTogJ1VzZXInLFxuICAgICAgICBsaXN0OiBbe1xuICAgICAgICAgICAgbmFtZTogXCJVc2Vyc1wiLFxuICAgICAgICAgICAgc3RhdGU6ICdtb2R1bGUtdXNlci1saXN0JyxcbiAgICAgICAgICAgIC8vZmE6ICdmYS1kYXNoYm9hcmQnXG4gICAgICAgIH0sIF0sXG4gICAgICAgIGFjdGl2ZTogJ0xvYWRpbmcuLi4nXG4gICAgfTtcblxuXG4gICAgdmFyIF91c2VyX2lkID0gJHN0YXRlLnBhcmFtcy5pZDtcblxuICAgICRzY29wZS5jcnVkID0ge1xuICAgICAgICBlcnJvcnM6IFtdXG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2hvd0Vycm9yKGVycm9yKSB7XG4gICAgICAgICRzY29wZS5jcnVkLmVycm9ycy5wdXNoKGVycm9yKTtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZm9ybUhhc0Vycm9ycygpIHtcbiAgICAgICAgJHNjb3BlLmNydWQuZXJyb3JzID0gW107XG4gICAgICAgIHZhciBoYXNFcnJvcnMgPSBmYWxzZTtcbiAgICAgICAgaWYgKF8uaXNVbmRlZmluZWQoJHNjb3BlLml0ZW0ubG9naW5uYW1lKSB8fCAkc2NvcGUuaXRlbS5sb2dpbm5hbWUgPT0gJycpIHtcbiAgICAgICAgICAgIGhhc0Vycm9ycyA9IHNob3dFcnJvcignVXNlcm5hbWUgcmVxdWlyZWQnKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoXy5pc1VuZGVmaW5lZCgkc2NvcGUuaXRlbS5maXJzdF9uYW1lKSB8fCAkc2NvcGUuaXRlbS5maXJzdF9uYW1lID09ICcnKSB7XG4gICAgICAgICAgICBoYXNFcnJvcnMgPSBzaG93RXJyb3IoJ0ZpcnN0IG5hbWUgcmVxdWlyZWQnKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoXy5pc1VuZGVmaW5lZCgkc2NvcGUuaXRlbS5sYXN0X25hbWUpIHx8ICRzY29wZS5pdGVtLmxhc3RfbmFtZSA9PSAnJykge1xuICAgICAgICAgICAgaGFzRXJyb3JzID0gc2hvd0Vycm9yKCdMYXN0IG5hbWUgcmVxdWlyZWQnKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoXy5pc1VuZGVmaW5lZCgkc2NvcGUuaXRlbS5fdXNlcmdyb3VwX2lkKSB8fCAkc2NvcGUuaXRlbS5fdXNlcmdyb3VwX2lkID09ICcnKSB7XG4gICAgICAgICAgICBoYXNFcnJvcnMgPSBzaG93RXJyb3IoJ1VzZXJncm91cCByZXF1aXJlZCcpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBoYXNFcnJvcnM7XG4gICAgfVxuXG4gICAgJHNjb3BlLnNhdmUgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgaWYgKCFmb3JtSGFzRXJyb3JzKCkpIHtcbiAgICAgICAgICAgIC8vY29uc29sZS5pbmZvKCdTYWx2YW5kbyEnKTtcbiAgICAgICAgICAgICRRSkFwaS5nZXRDb250cm9sbGVyKCd1c2VyJykucG9zdCh7XG4gICAgICAgICAgICAgICAgYWN0aW9uOiAnc2F2ZSdcbiAgICAgICAgICAgIH0sICRzY29wZS5pdGVtLCBmdW5jdGlvbihyZXMpIHtcbiAgICAgICAgICAgICAgICAkUUpMb2dnZXIubG9nKFwiVXNlckVkaXRDb250cm9sbGVyIC0+IHVzZXIgLT4gYXBpIHBvc3QgLT4gdXNlciBzYXZlIC0+IHN1Y2Nlc3NcIik7XG4gICAgICAgICAgICAgICAgLy9cbiAgICAgICAgICAgICAgICBzaG93RXJyb3IoJ0NhbWJpb3MgZ3VhcmRhZG9zJyk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfTtcbiAgICB9O1xuICAgICRzY29wZS5jYW5jZWwgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgJFFKSGVscGVyRnVuY3Rpb25zLmNoYW5nZVN0YXRlKCdtb2R1bGUtdXNlci1saXN0Jyk7XG4gICAgfTtcbiAgICAkc2NvcGUuZGVsZXRlID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciByID0gY29uZmlybShcIkRlbGV0ZSBcIiArICRzY29wZS5pdGVtLmxvZ2lubmFtZSArIFwiID9cIik7XG4gICAgICAgIGlmIChyID09IHRydWUpIHtcbiAgICAgICAgICAgICRRSkFwaS5nZXRDb250cm9sbGVyKCd1c2VyJykucG9zdCh7XG4gICAgICAgICAgICAgICAgYWN0aW9uOiAnZGVsZXRlJ1xuICAgICAgICAgICAgfSwgJHNjb3BlLml0ZW0sIGZ1bmN0aW9uKHJlcykge1xuICAgICAgICAgICAgICAgICRRSkxvZ2dlci5sb2coXCJVc2VyRWRpdENvbnRyb2xsZXIgLT4gdXNlciAtPiBhcGkgcG9zdCAtPiB1c2VyIGRlbGV0ZSAtPiBzdWNjZXNzXCIpO1xuICAgICAgICAgICAgICAgIC8vXG4gICAgICAgICAgICAgICAgc2hvd0Vycm9yKCdDYW1iaW9zIGd1YXJkYWRvcycpO1xuICAgICAgICAgICAgICAgIHNob3dFcnJvcigkc2NvcGUuaXRlbS5sb2dpbm5hbWUgKyAnIGVsaW1pbmFkbycpO1xuICAgICAgICAgICAgICAgIGNyZWF0ZSgpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSB7fVxuICAgIH1cblxuXG4gICAgZnVuY3Rpb24gY3JlYXRlKCkge1xuICAgICAgICAkc2NvcGUuaXRlbSA9IHtcbiAgICAgICAgICAgIGxvZ2lubmFtZTogJycsXG4gICAgICAgICAgICBmaXJzdF9uYW1lOiAnJyxcbiAgICAgICAgICAgIGxhc3RfbmFtZTogJycsXG4gICAgICAgICAgICBwYXNzd29yZDogJycsXG4gICAgICAgICAgICBfdXNlcmdyb3VwX2lkOiAkc2NvcGUuaXRlbS5fdXNlcmdyb3VwX2lkIHx8ICcnLFxuICAgICAgICAgICAgX2lkOiAtMVxuICAgICAgICB9O1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGxvYWRDb250cm9scygpIHtcblxuICAgICAgICAvL2NvbWJvYm94IG9ubHkgaXRlbXMgd2hvIHVzZXIgaGFzIGFjY2Vzc1xuICAgICAgICAkUUpDQ29tYm9ib3guY3JlYXRlKHtcbiAgICAgICAgICAgIG5hbWU6ICd1c2VyRWRpdFVzZXJncm91cEFjY2Vzc0NCTycsXG4gICAgICAgICAgICBsYWJlbDogXCJVc2VyZ3JvdXBcIixcbiAgICAgICAgICAgIGNvZGU6ICRzY29wZS5pdGVtLl91c2VyZ3JvdXBfaWQsXG4gICAgICAgICAgICBkaXNhYmxlZDp0cnVlLFxuICAgICAgICAgICAgY29kZV9jb3B5dG86ICdpdGVtLl91c2VyZ3JvdXBfaWQnLFxuICAgICAgICAgICAgYXBpOiB7XG4gICAgICAgICAgICAgICAgY29udHJvbGxlcjogJ3VzZXJncm91cCcsXG4gICAgICAgICAgICAgICAgcGFyYW1zOiB7XG4gICAgICAgICAgICAgICAgICAgIGFjdGlvbjogJ2NvbWJvYm94X2FjY2VzcydcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICB9LCAkc2NvcGUpO1xuXG5cbiAgICAgICAgLy9jb21ib2JveFxuICAgICAgICAkUUpDQ29tYm9ib3guY3JlYXRlKHtcbiAgICAgICAgICAgIG5hbWU6ICd1c2VyRWRpdFVzZXJncm91cENCTycsXG4gICAgICAgICAgICBsYWJlbDogXCJVc2VyZ3JvdXBcIixcbiAgICAgICAgICAgIGNvZGU6ICRzY29wZS5pdGVtLl91c2VyZ3JvdXBfaWQsXG4gICAgICAgICAgICBjb2RlX2NvcHl0bzogJ2l0ZW0uX3VzZXJncm91cF9pZCcsXG4gICAgICAgICAgICBhcGk6IHtcbiAgICAgICAgICAgICAgICBjb250cm9sbGVyOiAndXNlcmdyb3VwJyxcbiAgICAgICAgICAgICAgICBwYXJhbXM6IHtcbiAgICAgICAgICAgICAgICAgICAgYWN0aW9uOiAnY29tYm9ib3gnXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgfSwgJHNjb3BlKTtcbiAgICB9XG5cbiAgICBpZiAoX3VzZXJfaWQgPT0gLTEpIHtcbiAgICAgICAgLy9DUkVBVEVcbiAgICAgICAgY3JlYXRlKCk7XG4gICAgICAgIGxvYWRDb250cm9scygpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIC8vVVBEQVRFXG4gICAgICAgICRRSkFwaS5nZXRDb250cm9sbGVyKCd1c2VyJykuZ2V0KHtcbiAgICAgICAgICAgIGFjdGlvbjogJ3NpbmdsZScsXG4gICAgICAgICAgICBpZDogX3VzZXJfaWRcbiAgICAgICAgfSwgZnVuY3Rpb24ocmVzKSB7XG4gICAgICAgICAgICAkUUpMb2dnZXIubG9nKFwiVXNlckVkaXRDb250cm9sbGVyIC0+IHVzZXIgLT4gYXBpIGdldCAtPiB1c2VyIHNpbmdsZSAtPiBzdWNjZXNzXCIpO1xuICAgICAgICAgICAgJHNjb3BlLml0ZW0gPSByZXMudXNlcjtcbiAgICAgICAgICAgICRzY29wZS5icmVhZGNydW1iLmFjdGl2ZSA9ICRzY29wZS5pdGVtLmxvZ2lubmFtZTtcbiAgICAgICAgICAgIGxvYWRDb250cm9scygpO1xuICAgICAgICB9KTtcblxuICAgIH1cblxuXG5cbn0pO1xuXG5cbjtcbn0pLmNhbGwodGhpcyxyZXF1aXJlKFwiKzdaSnAwXCIpLHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvLi4vY29udHJvbGxlcnMvbW9kLnVzZXJzQ3RybC5qc1wiLFwiLy4uL2NvbnRyb2xsZXJzXCIpIiwiKGZ1bmN0aW9uIChwcm9jZXNzLGdsb2JhbCxCdWZmZXIsX19hcmd1bWVudDAsX19hcmd1bWVudDEsX19hcmd1bWVudDIsX19hcmd1bWVudDMsX19maWxlbmFtZSxfX2Rpcm5hbWUpe1xudmFyIG1vZHVsZSA9IHJlcXVpcmUoJy4vX21vZHVsZV9pbml0LmpzJyk7XG5tb2R1bGUuY29udHJvbGxlcignTmF2Q29udHJvbGxlcicsIGZ1bmN0aW9uKFxuXHQkUUpMb2dnZXIsICRRSkhlbHBlckZ1bmN0aW9ucywgJFFKQXBpLFxuXHQkc2NvcGUsICRyb290U2NvcGUsICRRSkxvZ2luTW9kdWxlLCAkUUpMb2NhbFNlc3Npb24sICRRSkNvbmZpZykge1xuXHQkUUpMb2dnZXIubG9nKFwiTmF2Q29udHJvbGxlciAtPiBpbml0aWFsaXplZFwiKTtcblxuXHQvL1NpZW1wcmUgcXVlIGVudHJhIGFsIGhvbWUgcmVjdXBlcmEgbG9zIGRhdG9zIGRlbCB1c3VhcmlvIGFjdHVhbCB5IGxvcyBzZXRlYSBnbG9iYWxtZW50ZSBlbiBlbCByb290U2NvcGUuXG5cdCRRSkFwaS5nZXRDb250cm9sbGVyKCd1c2VyJykuZ2V0KHtcblx0XHRhY3Rpb246ICdjdXJyZW50J1xuXHR9LCBmdW5jdGlvbihyZXMpIHtcblx0XHQkUUpMb2dnZXIubG9nKFwiSG9tZUNvbnRyb2xsZXIgLT4gdXNlciAtPiBhcGkgZ2V0IC0+IHVzZXIgc2luZ2xlIC0+IHN1Y2Nlc3NcIik7XG5cdFx0JHJvb3RTY29wZS5jdXJyZW50VXNlciA9IHJlcy51c2VyO1xuXHRcdCRyb290U2NvcGUuc2Vzc2lvbi51c2VyID0gcmVzLnVzZXI7XG5cdFx0JHJvb3RTY29wZS4kZW1pdCgnY3VycmVudFVzZXIuY2hhbmdlJyk7XG5cdFx0Ly9jb25zb2xlLmluZm8ocmVzKTtcblxuXG5cblx0fSk7XG5cblx0JHNjb3BlLnNpZ25vdXQgPSBmdW5jdGlvbigpIHtcblx0XHQkcm9vdFNjb3BlLnNlc3Npb24udG9rZW4gPSBudWxsO1xuXHRcdHN0b3JlLmNsZWFyKCk7XG5cdFx0JFFKSGVscGVyRnVuY3Rpb25zLmNoYW5nZVN0YXRlKCdsb2dpbicpO1xuXHRcdCRRSkxvZ2dlci5sb2coXCJOYXZDb250cm9sbGVyIC0+IHNpZ25vdXQgLT4gYXQgXCIgKyBuZXcgRGF0ZSgpKTtcblx0fVxufSk7XG59KS5jYWxsKHRoaXMscmVxdWlyZShcIis3WkpwMFwiKSx0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30scmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIsYXJndW1lbnRzWzNdLGFyZ3VtZW50c1s0XSxhcmd1bWVudHNbNV0sYXJndW1lbnRzWzZdLFwiLy4uL2NvbnRyb2xsZXJzL25hdkN0cmwuanNcIixcIi8uLi9jb250cm9sbGVyc1wiKSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbnZhciBtb2R1bGUgPSByZXF1aXJlKCcuL19tb2R1bGVfaW5pdC5qcycpO1xubW9kdWxlLmNvbnRyb2xsZXIoJ1FKQmFja2VuZFNldHRpbmdzQ29udHJvbGxlcicsIGZ1bmN0aW9uKFxuXHQkUUpBdXRoLCAkUUpDQ29tYm9ib3gsICRRSkxvZ2dlciwgJFFKSGVscGVyRnVuY3Rpb25zLCAkc2NvcGUsICRyb290U2NvcGUsICRRSkxvZ2luTW9kdWxlLCAkUUpBcGksICR0aW1lb3V0LCAkc3RhdGUsICRRSkxvZ2luTW9kdWxlXG4pIHtcblx0JFFKTG9nZ2VyLmxvZyhcIlFKQmFja2VuZFNldHRpbmdzQ29udHJvbGxlciAtPiBpbml0aWFsaXplZFwiKTtcblxuXG5cdCRzY29wZS5icmVhZGNydW1iID0ge1xuXHRcdG5hbWU6ICdTZXR0aW5ncycsXG5cdFx0bGlzdDogW1xuXHRcdFx0Ly97bmFtZTonTm9uZTInLHN0YXRlOicnLGZhOidmYS1kYXNoYm9hcmQnfVxuXHRcdF0sXG5cdFx0YWN0aXZlOiBcIlNldHRpbmdzXCJcblx0fTtcblxuXHRmdW5jdGlvbiBsb2FkQ29udHJvbHMoKSB7XG5cdFx0Ly9jb21ib2JveFxuXHRcdCRRSkNDb21ib2JveC5jcmVhdGUoe1xuXHRcdFx0bmFtZTogJ2NvbmZpZ0dyb3VwQ0JPJyxcblx0XHRcdGxhYmVsOiBcIkdydXBvIGRlIGltcGxlbWVudGFjaW9uXCIsXG5cdFx0XHRjb2RlOiAkc2NvcGUuc3RhdHMuX2dyb3VwX2lkLFxuXHRcdFx0Ly9jb2RlX2NvcHl0bzogJ3VzZXJzRmlsdGVyLmZpZWxkcy5fdXNlcmdyb3VwX2lkJyxcblx0XHRcdGFwaToge1xuXHRcdFx0XHRjb250cm9sbGVyOiAnZ3JvdXAnLFxuXHRcdFx0XHRwYXJhbXM6IHtcblx0XHRcdFx0XHRhY3Rpb246ICdjb21ib2JveF9hc3NvYydcblx0XHRcdFx0fVxuXHRcdFx0fSxcblx0XHR9LCAkc2NvcGUpO1xuXHR9XG5cblx0ZnVuY3Rpb24gb25Ub2tlblVwZGF0ZShjYWxsYmFjaykge1xuXHRcdCRRSkFwaS5nZXRDb250cm9sbGVyKCd1c2VyJykuZ2V0KHtcblx0XHRcdGFjdGlvbjogJ2N1cnJlbnQnXG5cdFx0fSwgZnVuY3Rpb24ocmVzKSB7XG5cdFx0XHQkUUpMb2dnZXIubG9nKFwiSG9tZUNvbnRyb2xsZXIgLT4gdXNlciAtPiBjdXJyZW50ICAtPiBzdWNjZXNzXCIpO1xuXHRcdFx0JHNjb3BlLnN0YXRzID0gcmVzLnVzZXI7XG5cdFx0XHQvL2NvbnNvbGUuaW5mbyhyZXMpO1xuXHRcdFx0Y2FsbGJhY2soKTtcblx0XHR9KTtcblx0fVxuXHQkcm9vdFNjb3BlLiRvbignc2Vzc2lvbi5jaGFuZ2UnLCBmdW5jdGlvbigpIHtcblx0XHRvblRva2VuVXBkYXRlKGZ1bmN0aW9uKCkge30pO1xuXHR9KTtcblx0b25Ub2tlblVwZGF0ZShmdW5jdGlvbigpIHtcblx0XHRsb2FkQ29udHJvbHMoKTtcblx0fSk7XG5cblxuXHQkc2NvcGUuJG9uKCdjb25maWdHcm91cENCTy5jaGFuZ2UnLCBmdW5jdGlvbihhcmdzMSwgYXJnczIpIHtcblx0XHRpZiAoYXJnczIuc2VsZWN0ZWRWYWx1ZSAhPT0gLTEgJiYgYXJnczIuc2VsZWN0ZWRWYWx1ZSAhPT0gJHNjb3BlLnN0YXRzLl9ncm91cF9pZCkge1xuXHRcdFx0Y29uc29sZS5pbmZvKCdjaGFuZ2luZyBpbXBsJyk7XG5cdFx0XHQkUUpBcGkuZ2V0Q29udHJvbGxlcignYXV0aCcpLnBvc3Qoe1xuXHRcdFx0XHRhY3Rpb246ICdjaGFuZ2Vncm91cCdcblx0XHRcdH0sIHtcblx0XHRcdFx0X2dyb3VwX2lkOiBhcmdzMi5zZWxlY3RlZFZhbHVlXG5cdFx0XHR9LCBmdW5jdGlvbihyZXMpIHtcblx0XHRcdFx0JFFKTG9nZ2VyLmxvZyhcIkhvbWVDb250cm9sbGVyIC0+IGF1dGggLT4gY2hhbmdlZ3JvdXAgIC0+IHN1Y2Nlc3NcIik7XG5cdFx0XHRcdCRRSkF1dGgudXBkYXRlU2Vzc2lvbkN1c3RvbShyZXMudG9rZW4sIGFyZ3MyLnNlbGVjdGVkVmFsdWUpO1xuXHRcdFx0fSk7XG5cblx0XHR9XG5cdH0pO1xuXG59KTtcbn0pLmNhbGwodGhpcyxyZXF1aXJlKFwiKzdaSnAwXCIpLHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvLi4vY29udHJvbGxlcnMvc2V0dGluZ3NDdHJsLmpzXCIsXCIvLi4vY29udHJvbGxlcnNcIikiLCIoZnVuY3Rpb24gKHByb2Nlc3MsZ2xvYmFsLEJ1ZmZlcixfX2FyZ3VtZW50MCxfX2FyZ3VtZW50MSxfX2FyZ3VtZW50MixfX2FyZ3VtZW50MyxfX2ZpbGVuYW1lLF9fZGlybmFtZSl7XG52YXIgbW9kdWxlID0gcmVxdWlyZSgnLi9fbW9kdWxlX2luaXQuanMnKTtcbm1vZHVsZS5jb250cm9sbGVyKCdTaWRlYmFyQ29udHJvbGxlcicsIGZ1bmN0aW9uKFxuICAgICRRSkxvZ2dlciwgJHNjb3BlLCAkcm9vdFNjb3BlLCAkUUpMb2dpbk1vZHVsZSwgJFFKTG9jYWxTZXNzaW9uLCAkUUpDb25maWcsICRRSkFwaSkge1xuICAgICRRSkxvZ2dlci5sb2coXCJTaWRlYmFyQ29udHJvbGxlciAtPiBpbml0aWFsaXplZFwiKTtcblxuICAgIGZ1bmN0aW9uIGdldE5vZGVzRm9yQ3VycmVudFRva2VuKCkge1xuICAgICAgICAvL1NpZW1wcmUgcXVlIGNhcmdhIGVsIHNpZGViYXIgcmVjdXBlcmEgZWwgbWVudSBwYXJhIGVsIHVzdWFyaW9cbiAgICAgICAgJFFKQXBpLmdldENvbnRyb2xsZXIoJ21vZHVsZScpLmdldCh7XG4gICAgICAgICAgICBhY3Rpb246ICdtZW51J1xuICAgICAgICB9LCBmdW5jdGlvbihyZXMpIHtcbiAgICAgICAgICAgICRRSkxvZ2dlci5sb2coXCJTaWRlYmFyQ29udHJvbGxlciAtPiBhcGkgZ2V0IC0+IG1vZHVsZSBtZW51IC0+IHN1Y2Nlc3NcIik7XG4gICAgICAgICAgICAvL2NvbnNvbGUuaW5mbyhyZXMpO1xuICAgICAgICAgICAgJHNjb3BlLm1vZHVsZXMgPSByZXMubW9kdWxlcztcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgJHJvb3RTY29wZS4kb24oJ3Nlc3Npb24uY2hhbmdlJywgZnVuY3Rpb24oYXJnczEsIGFyZ3MyKSB7XG4gICAgICAgIGdldE5vZGVzRm9yQ3VycmVudFRva2VuKCk7XG4gICAgfSk7XG5cbiAgICBnZXROb2Rlc0ZvckN1cnJlbnRUb2tlbigpO1xufSk7XG59KS5jYWxsKHRoaXMscmVxdWlyZShcIis3WkpwMFwiKSx0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30scmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIsYXJndW1lbnRzWzNdLGFyZ3VtZW50c1s0XSxhcmd1bWVudHNbNV0sYXJndW1lbnRzWzZdLFwiLy4uL2NvbnRyb2xsZXJzL3NpZGViYXJDdHJsLmpzXCIsXCIvLi4vY29udHJvbGxlcnNcIikiLCIoZnVuY3Rpb24gKHByb2Nlc3MsZ2xvYmFsLEJ1ZmZlcixfX2FyZ3VtZW50MCxfX2FyZ3VtZW50MSxfX2FyZ3VtZW50MixfX2FyZ3VtZW50MyxfX2ZpbGVuYW1lLF9fZGlybmFtZSl7XG52YXIgbW9kdWxlID0gcmVxdWlyZSgnLi9fbW9kdWxlX2luaXQuanMnKTtcbm1vZHVsZS5jb250cm9sbGVyKCdWaXBzdGVyQ29uZmlnQ29udHJvbGxlcicsIGZ1bmN0aW9uKFxuICAgICRRSkNDb21ib2JveCwgJFFKQ1NlbGVjdGtleSwgJFFKQ0xpc3R2aWV3LCAkUUpDRmlsdGVyLCAkUUpMb2dnZXJcbiAgICAsICRRSkhlbHBlckZ1bmN0aW9ucywgJHNjb3BlLCAkcm9vdFNjb3BlLCAkUUpMb2dpbk1vZHVsZSwgJFFKQXBpLCAkdGltZW91dCwgJHN0YXRlLCAkUUpMb2dpbk1vZHVsZVxuKSB7XG4gICAgJFFKTG9nZ2VyLmxvZyhcIlZpcHN0ZXJDb25maWdDb250cm9sbGVyIC0+IGluaXRpYWxpemVkXCIpO1xuXG5cbn0pO1xuXG59KS5jYWxsKHRoaXMscmVxdWlyZShcIis3WkpwMFwiKSx0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30scmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIsYXJndW1lbnRzWzNdLGFyZ3VtZW50c1s0XSxhcmd1bWVudHNbNV0sYXJndW1lbnRzWzZdLFwiLy4uL2NvbnRyb2xsZXJzL3ZwLmNvbmZpZ0N0cmwuanNcIixcIi8uLi9jb250cm9sbGVyc1wiKSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbm1vZHVsZS5leHBvcnRzID0gYW5ndWxhci5tb2R1bGUoJ2FwcC5jb250cm9scycsIFtdKTtcbnJlcXVpcmUoJy4vcWpjb21ib2JveEN0cmwuanMnKTtcbnJlcXVpcmUoJy4vcWpmaWx0ZXJDdHJsLmpzJyk7XG5yZXF1aXJlKCcuL3FqbGlzdHZpZXdDdHJsLmpzJyk7XG5yZXF1aXJlKCcuL3FqdGltZXJjb3VudGVyQ3RybC5qcycpO1xufSkuY2FsbCh0aGlzLHJlcXVpcmUoXCIrN1pKcDBcIiksdHlwZW9mIHNlbGYgIT09IFwidW5kZWZpbmVkXCIgPyBzZWxmIDogdHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiA/IHdpbmRvdyA6IHt9LHJlcXVpcmUoXCJidWZmZXJcIikuQnVmZmVyLGFyZ3VtZW50c1szXSxhcmd1bWVudHNbNF0sYXJndW1lbnRzWzVdLGFyZ3VtZW50c1s2XSxcIi8uLi9jb250cm9scy9fbW9kdWxlX2luaXQuanNcIixcIi8uLi9jb250cm9sc1wiKSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbnZhciBtb2R1bGUgPSByZXF1aXJlKCcuL19tb2R1bGVfaW5pdC5qcycpO1xubW9kdWxlLmZhY3RvcnkoJyRRSkNDb21ib2JveCcsIFtcblx0JyRRSkFwaScsICckUUpIZWxwZXJGdW5jdGlvbnMnLCAnJFFKTG9nZ2VyJywgJyRyb290U2NvcGUnLCAnJHN0YXRlJywgJyR0aW1lb3V0JywgJyRRSkxvY2FsU2Vzc2lvbicsICckUUpBdXRoJyxcblx0ZnVuY3Rpb24oJFFKQXBpLCAkUUpIZWxwZXJGdW5jdGlvbnMsICRRSkxvZ2dlciwgJHJvb3RTY29wZSwgJHN0YXRlLCAkdGltZW91dCwgJFFKTG9jYWxTZXNzaW9uLCAkUUpBdXRoKSB7XG5cdFx0ZnVuY3Rpb24gc2Vla09iamVjdChmdWxsbmFtZSwgJHNjb3BlLCBvYmosIGluZGV4KSB7XG5cdFx0XHRpZiAoaW5kZXggPT0gMCkge1xuXHRcdFx0XHQkUUpMb2dnZXIubG9nKCdRSkNTZWxlY3RrZXkgLT4gc2Vla09iamVjdCAtPiBzb21ldGhpbmcgd2VudCB3cm9uZyBhbmQgaSBhYm9ydCB0aGUgcmVjdXJzaXZlIGZ1bmMgYnJvIScpO1xuXHRcdFx0fVxuXHRcdFx0aWYgKCFfLmlzVW5kZWZpbmVkKG9iaikgJiYgXy5pc051bGwob2JqKSkge1xuXHRcdFx0XHRyZXR1cm4gb2JqO1xuXHRcdFx0fVxuXHRcdFx0aWYgKGZ1bGxuYW1lLnRvU3RyaW5nKCkuc3BsaXQoJy4nKS5sZW5ndGggPT0gMSB8fCBpbmRleCA9PSAwKSB7XG5cdFx0XHRcdGlmICghXy5pc1VuZGVmaW5lZChvYmopKSB7XG5cdFx0XHRcdFx0cmV0dXJuIG9ialtmdWxsbmFtZV0gfHwgbnVsbDtcblx0XHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0XHRyZXR1cm4gJHNjb3BlW2Z1bGxuYW1lXSB8fCBudWxsO1xuXHRcdFx0XHR9XG5cblx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdHZhciBmaXJzdFBhcnQgPSBmdWxsbmFtZS50b1N0cmluZygpLnNwbGl0KCcuJylbMF07XG5cdFx0XHRcdHZhciByZXN0ID0gZnVsbG5hbWUuc3Vic3RyaW5nKGZpcnN0UGFydC5sZW5ndGggKyAxKTtcblx0XHRcdFx0Ly9jb25zb2xlLmxvZyhcIm9iaiAtPlwiK29iaik7XG5cdFx0XHRcdC8vY29uc29sZS5sb2coXCJmaXJzdHBhcnQtPlwiK2ZpcnN0UGFydCk7XG5cdFx0XHRcdC8vY29uc29sZS5sb2coXCJyZXN0LT5cIityZXN0KTtcblx0XHRcdFx0cmV0dXJuIHNlZWtPYmplY3QocmVzdCwgJHNjb3BlLCBvYmogIT0gbnVsbCA/IG9ialtmaXJzdFBhcnRdIDogJHNjb3BlW2ZpcnN0UGFydF0sIChfLmlzVW5kZWZpbmVkKGluZGV4KSA/IDIwIDogaW5kZXgtLSkpO1xuXHRcdFx0fVxuXHRcdH07XG5cdFx0cmV0dXJuIHtcblx0XHRcdGNyZWF0ZTogZnVuY3Rpb24oc2V0dGluZ3MsICRzY29wZSkge1xuXG5cdFx0XHRcdC8qXG5cdFx0XHRcdGNvbnNvbGUuaW5mbygnUUpDQ29tYm9ib3ggLT4gIExPQUQgJ1xuXHRcdFx0XHRcdCsgJyBDT0RFWycrc2V0dGluZ3MuY29kZSsnXSdcblx0XHRcdFx0KTtcbiovXG5cblx0XHRcdFx0c2V0dGluZ3MuY29kZV9jb3B5dG8gPSBzZXR0aW5ncy5jb2RlX2NvcHl0byB8fCBudWxsO1xuXHRcdFx0XHRzZXR0aW5ncy5kZXNjcmlwdGlvbl9jb3B5dG8gPSBzZXR0aW5ncy5kZXNjcmlwdGlvbl9jb3B5dG8gfHwgbnVsbDtcblxuXG5cdFx0XHRcdHZhciBzZWxmID0gc2V0dGluZ3M7XG5cblx0XHRcdFx0c2VsZi5pbml0aWFsVmFsdWUgPSBzZXR0aW5ncy5jb2RlO1xuXHRcdFx0XHRzZWxmLnNlbGVjdGVkVmFsdWUgPSBzZWxmLnNlbGVjdGVkVmFsdWUgfHwgLTE7XG5cdFx0XHRcdHNlbGYuZGlzYWJsZWQgPSBzZWxmLmRpc2FibGVkIHx8IGZhbHNlO1xuXG5cdFx0XHRcdHNlbGYubmdTZWxlY3RlZCA9IGZ1bmN0aW9uKGl0ZW0pIHtcblx0XHRcdFx0XHRyZXR1cm4gaXRlbS5faWQgPT0gc2VsZi5pbml0aWFsVmFsdWU7XG5cdFx0XHRcdH07XG5cblx0XHRcdFx0JHNjb3BlW3NldHRpbmdzLm5hbWVdID0gc2VsZjsgLy9zZXRzIHRvIHRoZSBzY29wZSAhISEhXG5cblx0XHRcdFx0aWYgKHR5cGVvZiBjYm8gPT0gXCJ1bmRlZmluZWRcIikge1xuXHRcdFx0XHRcdGNibyA9IFtdO1xuXHRcdFx0XHR9XG5cdFx0XHRcdGNiby5wdXNoKHNlbGYpO1xuXG5cdFx0XHRcdCRzY29wZS4kd2F0Y2goc2V0dGluZ3MubmFtZSArIFwiLnNlbGVjdGVkVmFsdWVcIiwgZnVuY3Rpb24obmV3VmFsLCBvbGRWYWwpIHtcblx0XHRcdFx0XHRzZWxmLmNvZGUgPSBuZXdWYWw7XG5cdFx0XHRcdFx0JHNjb3BlLiRlbWl0KHNldHRpbmdzLm5hbWUgKyAnLmNoYW5nZScsIHtcblx0XHRcdFx0XHRcdHNlbGVjdGVkVmFsdWU6IG5ld1ZhbFxuXHRcdFx0XHRcdH0pO1xuXHRcdFx0XHR9KTtcblx0XHRcdFx0JHNjb3BlLiR3YXRjaChzZXR0aW5ncy5uYW1lICsgXCIuY29kZVwiLCBmdW5jdGlvbihuZXdWYWwsIG9sZFZhbCkge1xuXHRcdFx0XHRcdHNlbGYuc2VsZWN0ZWRWYWx1ZSA9IG5ld1ZhbDtcblxuXHRcdFx0XHRcdHNlbGYuZGVzY3JpcHRpb24gPSAoXy5maW5kKHNlbGYuaXRlbXMsIGZ1bmN0aW9uKGl0ZW0pIHtcblx0XHRcdFx0XHRcdHJldHVybiBpdGVtLl9pZCA9PSBuZXdWYWw7XG5cdFx0XHRcdFx0fSkpO1xuXHRcdFx0XHRcdHNlbGYuZGVzY3JpcHRpb24gPSBzZWxmLmRlc2NyaXB0aW9uICYmIHNlbGYuZGVzY3JpcHRpb24uZGVzY3JpcHRpb24gfHwgXCJcIjtcblxuXHRcdFx0XHRcdCRzY29wZS4kZW1pdChzZXR0aW5ncy5uYW1lICsgJy5jaGFuZ2UnLCB7XG5cdFx0XHRcdFx0XHRzZWxlY3RlZFZhbHVlOiBuZXdWYWxcblx0XHRcdFx0XHR9KTtcblx0XHRcdFx0fSk7XG5cblx0XHRcdFx0ZnVuY3Rpb24gY29weShvYmosIGZpZWxkV29yZCwgdmFsKSB7XG5cdFx0XHRcdFx0aWYgKF8uaXNVbmRlZmluZWQodmFsKSkge1xuXHRcdFx0XHRcdFx0cmV0dXJuO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0XHRpZiAodmFsLnRvU3RyaW5nKCkgPT09ICctMScpIHtcblx0XHRcdFx0XHRcdG9ialtmaWVsZFdvcmRdID0gJyc7XG5cdFx0XHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0XHRcdG9ialtmaWVsZFdvcmRdID0gdmFsO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fVxuXG5cdFx0XHRcdGZ1bmN0aW9uIGNvcHlXaGVuUG9zaWJsZShmdWxscGF0aCwgdmFsKSB7XG5cdFx0XHRcdFx0aWYgKF8uaXNVbmRlZmluZWQoZnVsbHBhdGgpIHx8IF8uaXNOdWxsKGZ1bGxwYXRoKSB8fCBmdWxscGF0aC5sZW5ndGggPT0gMCkge1xuXHRcdFx0XHRcdFx0cmV0dXJuOyAvL29taXQhXG5cdFx0XHRcdFx0fVxuXHRcdFx0XHRcdHZhciBjdXRzID0gZnVsbHBhdGgudG9TdHJpbmcoKS5zcGxpdCgnLicpO1xuXHRcdFx0XHRcdHZhciBmaWVsZFdvcmQgPSBjdXRzW2N1dHMubGVuZ3RoIC0gMV07XG5cdFx0XHRcdFx0dmFyIHBvcyA9IGZ1bGxwYXRoLnRvU3RyaW5nKCkuaW5kZXhPZignLicgKyBmaWVsZFdvcmQpO1xuXHRcdFx0XHRcdHZhciBwYXRoID0gZnVsbHBhdGgudG9TdHJpbmcoKS5zdWJzdHJpbmcoMCwgcG9zKTtcblx0XHRcdFx0XHQvL2NvbnNvbGUuaW5mbyhcInNlZWtpbmcgZm9yIHBhdGggb2JqIG9uIF8+Pj4+IFwiK3BhdGgpO1xuXHRcdFx0XHRcdHZhciBvYmogPSBzZWVrT2JqZWN0KHBhdGgsICRzY29wZSk7XG5cdFx0XHRcdFx0Ly9jb25zb2xlLmluZm8oXCJmb3VuZGVkIFwiK0pTT04uc3RyaW5naWZ5KG9iaikpO1xuXHRcdFx0XHRcdGlmIChfLmlzVW5kZWZpbmVkKG9iaikgfHwgXy5pc051bGwob2JqKSkge1xuXHRcdFx0XHRcdFx0Y29uc29sZS5pbmZvKFwiY29weVdoZW5Qb3NpYmxlIGZhaWx1cmUgZm9yIHBhdGggLT4gXCIgKyBmdWxscGF0aCk7XG5cdFx0XHRcdFx0XHRyZXR1cm47IC8vb21pdCFcblx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0Y29weShvYmosIGZpZWxkV29yZCwgdmFsKTtcblx0XHRcdFx0fVxuXG5cblx0XHRcdFx0JHNjb3BlLiR3YXRjaChzZXR0aW5ncy5uYW1lICsgJy5jb2RlJywgZnVuY3Rpb24obmV3VmFsLCBvbGRWYWwpIHtcblx0XHRcdFx0XHRjb3B5V2hlblBvc2libGUoc2VsZi5jb2RlX2NvcHl0bywgbmV3VmFsKTtcblx0XHRcdFx0fSk7XG5cdFx0XHRcdGNvcHlXaGVuUG9zaWJsZShzZWxmLmNvZGVfY29weXRvLCBzZWxmLmNvZGUgfHwgJycpO1xuXG5cblxuXHRcdFx0XHQvL3NldCBkZWZhdWx0c1xuXHRcdFx0XHQkc2NvcGUuJGVtaXQoc2V0dGluZ3MubmFtZSArICcuY2hhbmdlJywge1xuXHRcdFx0XHRcdHNlbGVjdGVkVmFsdWU6IHNlbGYuY29kZVxuXHRcdFx0XHR9KTtcblxuXHRcdFx0XHRpZiAoc2VsZi5kZXNjcmlwdGlvbl9jb3B5dG8gIT0gbnVsbCkge1xuXHRcdFx0XHRcdHZhciBjdXRzID0gc2VsZi5kZXNjcmlwdGlvbl9jb3B5dG8udG9TdHJpbmcoKS5zcGxpdCgnLicpO1xuXHRcdFx0XHRcdHNlbGYuZGVzY3JpcHRpb25fY29weXRvX2ZpZWxkV29yZCA9IGN1dHNbY3V0cy5sZW5ndGggLSAxXTtcblx0XHRcdFx0XHR2YXIgcG9zID0gc2VsZi5kZXNjcmlwdGlvbl9jb3B5dG8udG9TdHJpbmcoKS5pbmRleE9mKCcuJyArIHNlbGYuZGVzY3JpcHRpb25fY29weXRvX2ZpZWxkV29yZCk7XG5cdFx0XHRcdFx0dmFyIHBhdGggPSBzZWxmLmRlc2NyaXB0aW9uX2NvcHl0by50b1N0cmluZygpLnN1YnN0cmluZygwLCBwb3MpO1xuXHRcdFx0XHRcdHNlbGYuZGVzY3JpcHRpb25fY29weXRvX29iaiA9IHNlZWtPYmplY3QocGF0aCwgJHNjb3BlKTtcblx0XHRcdFx0XHQkc2NvcGUuJHdhdGNoKHNldHRpbmdzLm5hbWUgKyAnLmRlc2NyaXB0aW9uJywgZnVuY3Rpb24obmV3VmFsLCBvbGRWYWwpIHtcblx0XHRcdFx0XHRcdGNvcHkoc2VsZi5kZXNjcmlwdGlvbl9jb3B5dG9fb2JqLCBzZWxmLmRlc2NyaXB0aW9uX2NvcHl0b19maWVsZFdvcmQsIG5ld1ZhbCk7XG5cdFx0XHRcdFx0fSk7XG5cdFx0XHRcdFx0Y29weShzZWxmLmRlc2NyaXB0aW9uX2NvcHl0b19vYmosIHNlbGYuZGVzY3JpcHRpb25fY29weXRvX2ZpZWxkV29yZCwgc2VsZi5kZXNjcmlwdGlvbiB8fCAnJyk7XG5cdFx0XHRcdFx0JHNjb3BlLiRlbWl0KHNldHRpbmdzLm5hbWUgKyAnLmRlc2NyaXB0aW9uJywge1xuXHRcdFx0XHRcdFx0ZGVzY3JpcHRpb246IHNlbGYuZGVzY3JpcHRpb25cblx0XHRcdFx0XHR9KTtcblx0XHRcdFx0fVxuXG5cblx0XHRcdFx0c2VsZi51cGRhdGUgPSBmdW5jdGlvbigpIHtcblx0XHRcdFx0XHQkUUpBcGkuZ2V0Q29udHJvbGxlcihzZXR0aW5ncy5hcGkuY29udHJvbGxlcikuZ2V0KHNldHRpbmdzLmFwaS5wYXJhbXMsIGZ1bmN0aW9uKHJlcykge1xuXHRcdFx0XHRcdFx0Ly8kUUpMb2dnZXIubG9nKFwiUUpDQ29tYm9ib3ggLT4gXCIrc2V0dGluZ3MubmFtZStcIiAtPiBcIiArIHNldHRpbmdzLmFwaS5jb250cm9sbGVyICsgXCIgIFwiICsgc2V0dGluZ3MuYXBpLnBhcmFtcy5hY3Rpb24gKyBcIiAoXCIrSlNPTi5zdHJpbmdpZnkoc2V0dGluZ3MuYXBpLnBhcmFtcykrXCIpIC0+IHN1Y2Nlc3NcIik7XG5cdFx0XHRcdFx0XHRzZWxmLml0ZW1zID0gcmVzLml0ZW1zO1xuXHRcdFx0XHRcdFx0c2VsZi5zZWxlY3RlZFZhbHVlID0gc2VsZi5pbml0aWFsVmFsdWU7XG5cdFx0XHRcdFx0XHQvL2NvbnNvbGUuaW5mbyhyZXMucmVxKTtcblx0XHRcdFx0XHR9KTtcblx0XHRcdFx0fTtcblx0XHRcdFx0c2VsZi51cGRhdGUoKTsgLy9pbml0aWFsXG5cblx0XHRcdFx0Ly93YXRjaCBmb3IgcGFyYW1zIGNoYW5nZSB0byB1cGRhdGVcblx0XHRcdFx0JHNjb3BlLiR3YXRjaChzZXR0aW5ncy5uYW1lICsgJy5hcGkucGFyYW1zJywgZnVuY3Rpb24obmV3VmFsLCBvbGRWYWwpIHtcblx0XHRcdFx0XHRzZWxmLnVwZGF0ZSgpO1xuXHRcdFx0XHRcdC8vJFFKTG9nZ2VyLmxvZyhcIlFKQ0NvbWJvYm94IC0+IFwiICsgc2V0dGluZ3MubmFtZSArIFwiIC0+IHBhcmFtcyBjaGFuZ2VzIC0+IHVwZGF0aW5nLi5cIik7XG5cdFx0XHRcdH0sIHRydWUpO1xuXG5cblx0XHRcdH1cblx0XHR9O1xuXHR9XG5dKTtcbm1vZHVsZS5kaXJlY3RpdmUoJ3FqY2NvbWJvYm94JywgZnVuY3Rpb24oJHJvb3RTY29wZSkge1xuXHR2YXIgZGlyZWN0aXZlID0ge307XG5cdGRpcmVjdGl2ZS5yZXN0cmljdCA9ICdFJzsgLyogcmVzdHJpY3QgdGhpcyBkaXJlY3RpdmUgdG8gZWxlbWVudHMgKi9cblx0ZGlyZWN0aXZlLnRlbXBsYXRlVXJsID0gXCJwYWdlcy9jb250cm9scy9xamNjb21ib2JveC5odG1sXCI7XG5cdGRpcmVjdGl2ZS5zY29wZSA9IHtcblx0XHRjYm86ICc9J1xuXHR9O1xuXHRkaXJlY3RpdmUuY29tcGlsZSA9IGZ1bmN0aW9uKGVsZW1lbnQsIGF0dHJpYnV0ZXMpIHtcblx0XHR2YXIgbGlua0Z1bmN0aW9uID0gZnVuY3Rpb24oJHNjb3BlLCBlbGVtZW50LCBhdHRyaWJ1dGVzKSB7fVxuXHRcdHJldHVybiBsaW5rRnVuY3Rpb247XG5cdH1cblx0cmV0dXJuIGRpcmVjdGl2ZTtcbn0pO1xufSkuY2FsbCh0aGlzLHJlcXVpcmUoXCIrN1pKcDBcIiksdHlwZW9mIHNlbGYgIT09IFwidW5kZWZpbmVkXCIgPyBzZWxmIDogdHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiA/IHdpbmRvdyA6IHt9LHJlcXVpcmUoXCJidWZmZXJcIikuQnVmZmVyLGFyZ3VtZW50c1szXSxhcmd1bWVudHNbNF0sYXJndW1lbnRzWzVdLGFyZ3VtZW50c1s2XSxcIi8uLi9jb250cm9scy9xamNvbWJvYm94Q3RybC5qc1wiLFwiLy4uL2NvbnRyb2xzXCIpIiwiKGZ1bmN0aW9uIChwcm9jZXNzLGdsb2JhbCxCdWZmZXIsX19hcmd1bWVudDAsX19hcmd1bWVudDEsX19hcmd1bWVudDIsX19hcmd1bWVudDMsX19maWxlbmFtZSxfX2Rpcm5hbWUpe1xudmFyIG1vZHVsZSA9IHJlcXVpcmUoJy4vX21vZHVsZV9pbml0LmpzJyk7XG5tb2R1bGUuZmFjdG9yeSgnJFFKQ0ZpbHRlcicsIFtcblx0JyRRSkxvZ2dlcicsICckcm9vdFNjb3BlJywgJyRzdGF0ZScsICckdGltZW91dCcsICckUUpMb2NhbFNlc3Npb24nLCAnJFFKQXV0aCcsXG5cdGZ1bmN0aW9uKCRRSkxvZ2dlciwgJHJvb3RTY29wZSwgJHN0YXRlLCAkdGltZW91dCwgJFFKTG9jYWxTZXNzaW9uLCAkUUpBdXRoKSB7XG5cdFx0dmFyIHNlbGYgPSB7XG5cdFx0XHRmaWVsZHM6IHt9XG5cdFx0fTtcblxuXHRcdGZ1bmN0aW9uIGdldEJpbmRlZEFycmF5KGFycmF5TmFtZSwgJHNjb3BlLCBvYmosIGluZGV4KSB7XG5cdFx0XHRpZiAoaW5kZXggPT0gMCkge1xuXHRcdFx0XHQkUUpMb2dnZXIubG9nKCdRSkNGaWx0ZXIgLT4gZ2V0QmluZGVkQXJyYXkgLT4gc29tZXRoaW5nIHdlbnQgd3JvbmcgYW5kIGkgYWJvcnQgdGhlIHJlY3Vyc2l2ZSBmdW5jIGJybyEnKTtcblx0XHRcdH1cblx0XHRcdGlmICghXy5pc1VuZGVmaW5lZChvYmopICYmIF8uaXNOdWxsKG9iaikpIHtcblx0XHRcdFx0cmV0dXJuIG9iajtcblx0XHRcdH1cblx0XHRcdGlmIChhcnJheU5hbWUudG9TdHJpbmcoKS5zcGxpdCgnLicpLmxlbmd0aCA9PSAxIHx8IGluZGV4ID09IDApIHtcblx0XHRcdFx0Ly9jb25zb2xlLmluZm8oYXJyYXlOYW1lKTtcblx0XHRcdFx0aWYgKCFfLmlzVW5kZWZpbmVkKG9iaikpIHtcblx0XHRcdFx0XHRyZXR1cm4gb2JqW2FycmF5TmFtZV0gfHwgbnVsbDtcblx0XHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0XHQvL2NvbnNvbGUuaW5mbygncmV0dXJuIHRoaXMgLT4nK2FycmF5TmFtZSk7XG5cdFx0XHRcdFx0Ly9jb25zb2xlLmluZm8oJHNjb3BlW2FycmF5TmFtZV0pO1xuXHRcdFx0XHRcdHJldHVybiAkc2NvcGVbYXJyYXlOYW1lXSB8fCBudWxsO1xuXHRcdFx0XHR9XG5cblx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdHZhciBmaXJzdFBhcnQgPSBhcnJheU5hbWUudG9TdHJpbmcoKS5zcGxpdCgnLicpWzBdO1xuXHRcdFx0XHR2YXIgcmVzdCA9IGFycmF5TmFtZS5zdWJzdHJpbmcoZmlyc3RQYXJ0Lmxlbmd0aCArIDEpO1xuXHRcdFx0XHQvL2NvbnNvbGUuaW5mbyhhcnJheU5hbWUpO1xuXHRcdFx0XHRyZXR1cm4gZ2V0QmluZGVkQXJyYXkocmVzdCwgJHNjb3BlLCAkc2NvcGVbZmlyc3RQYXJ0XSwgKF8uaXNVbmRlZmluZWQoaW5kZXgpID8gMjAgOiBpbmRleC0tKSk7XG5cdFx0XHR9XG5cblx0XHR9O1xuXHRcdHJldHVybiB7XG5cdFx0XHRjcmVhdGU6IGZ1bmN0aW9uKHNldHRpbmdzLCAkc2NvcGUpIHtcblx0XHRcdFx0Xy5lYWNoKHNldHRpbmdzLmZpZWxkcywgZnVuY3Rpb24oZmllbGQsIGtleSkge1xuXHRcdFx0XHRcdHNlbGYuZmllbGRzW2ZpZWxkLm5hbWVdID0gbnVsbDtcblx0XHRcdFx0fSk7XG5cblx0XHRcdFx0Ly9kZWZhdWx0c1xuXHRcdFx0XHRzZXR0aW5ncy5maWx0ZXJlZGZpZWxkTmFtZSA9IHNldHRpbmdzLmZpbHRlcmVkZmllbGROYW1lIHx8ICdfcWpmaWx0ZXJlZCc7XG5cblx0XHRcdFx0Ly9zdG9yZXMgc2V0dGluZ3MgYXMgcHJvcGVydHlcblx0XHRcdFx0c2VsZi5zZXR0aW5ncyA9IHNldHRpbmdzO1xuXHRcdFx0XHQkc2NvcGVbc2V0dGluZ3MubmFtZV0gPSBzZWxmO1xuXG5cdFx0XHRcdHNlbGYuZmlsdGVyID0gZnVuY3Rpb24oKSB7XG5cdFx0XHRcdFx0Ly9jb25zb2xlLmNsZWFyKCk7XG5cdFx0XHRcdFx0Y29udGFpblZhbGlkYXRpb25TdWNjZXNzSXRlbXNLZXlzID0gW107XG5cdFx0XHRcdFx0Xy5lYWNoKHNlbGYuZmllbGRzLCBmdW5jdGlvbih2YWwsIGtleSkge1xuXHRcdFx0XHRcdFx0dmFyIGtleVdob0NoYW5nZXMgPSBrZXk7IC8vdXBkYXRlcyBiYXNlZCBvbiBhbGwgZmlsdGVycyAhIGZpeFxuXHRcdFx0XHRcdFx0dmFyIG5ld0ZpZWxkVmFsdWUgPSB2YWw7XG5cdFx0XHRcdFx0XHRfLmVhY2goc2V0dGluZ3MuZmllbGRzLCBmdW5jdGlvbihmaWVsZCwga2V5KSB7XG5cdFx0XHRcdFx0XHRcdGlmIChrZXlXaG9DaGFuZ2VzICE9PSBmaWVsZC5uYW1lKSByZXR1cm47IC8vdGFrZSBvbmx5IHRoZSBvbmUgd2hvIGNoYW5nZXNcblx0XHRcdFx0XHRcdFx0dmFyIGJpbmRlZEFycmF5ID0gZ2V0QmluZGVkQXJyYXkoZmllbGQuYXJyYXlOYW1lLCAkc2NvcGUpO1xuXHRcdFx0XHRcdFx0XHRpZiAoYmluZGVkQXJyYXkgIT09IG51bGwpIHtcblx0XHRcdFx0XHRcdFx0XHRfLmVhY2goYmluZGVkQXJyYXksIGZ1bmN0aW9uKGJpbmRlZEFycmF5SXRlbSwgYmluZGVkQXJyYXlJdGVtS2V5KSB7XG5cdFx0XHRcdFx0XHRcdFx0XHRiaW5kZWRBcnJheUl0ZW1IYXNTdWNjZXNzQW55ID0gKG51bGwgIT0gXy5maW5kKGNvbnRhaW5WYWxpZGF0aW9uU3VjY2Vzc0l0ZW1zS2V5cywgZnVuY3Rpb24odmFsKSB7XG5cdFx0XHRcdFx0XHRcdFx0XHRcdHJldHVybiB2YWwgPT0gYmluZGVkQXJyYXlJdGVtS2V5XG5cdFx0XHRcdFx0XHRcdFx0XHR9KSk7XG5cdFx0XHRcdFx0XHRcdFx0XHRpZiAoYmluZGVkQXJyYXlJdGVtSGFzU3VjY2Vzc0FueSkge1xuXHRcdFx0XHRcdFx0XHRcdFx0XHRyZXR1cm47IC8vIGp1bXAgYmVjYXVzZSBhbHJlZHkgc3VjY2VzIHZhbGlkYXRpb24gYW5kIGl0IG5vdCBnb25uYSBiZSBmaWx0ZXJlZFxuXHRcdFx0XHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0XHRcdFx0dmFyIGNvbnRhaW5WYWxpZGF0aW9uUmVzcG9uc2UgPSBbXTtcblx0XHRcdFx0XHRcdFx0XHRcdF8uZWFjaChmaWVsZC5iaW5kVG8sIGZ1bmN0aW9uKGJpbmRUb0ZpZWxkLCBrZXkpIHtcblx0XHRcdFx0XHRcdFx0XHRcdFx0dmFyIF9maWVsZCA9IGJpbmRlZEFycmF5SXRlbVtiaW5kVG9GaWVsZF07XG5cdFx0XHRcdFx0XHRcdFx0XHRcdGlmICghXy5pc1VuZGVmaW5lZChfZmllbGQpKSB7XG5cdFx0XHRcdFx0XHRcdFx0XHRcdFx0aWYgKF9maWVsZCAhPT0gbnVsbCkge1xuXHRcdFx0XHRcdFx0XHRcdFx0XHRcdFx0dmFyIGZsYWcgPSB0cnVlO1xuXHRcdFx0XHRcdFx0XHRcdFx0XHRcdFx0aWYgKF8uaXNVbmRlZmluZWQobmV3RmllbGRWYWx1ZSkgfHwgXy5pc051bGwobmV3RmllbGRWYWx1ZSkgfHwgbmV3RmllbGRWYWx1ZSA9PSBcIlwiKSB7XG5cdFx0XHRcdFx0XHRcdFx0XHRcdFx0XHRcdHJldHVybjsgLy8ganVtcCBiZWNhdXNlIGZpbHRlciBmaWVsZCBpcyBlbXB0eSFcblx0XHRcdFx0XHRcdFx0XHRcdFx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdFx0XHRcdFx0XHRcdFx0XHRcdHZhciBpbmRleG9mID0gX2ZpZWxkLnRvU3RyaW5nKCkudG9Mb3dlckNhc2UoKS5pbmRleE9mKG5ld0ZpZWxkVmFsdWUudG9TdHJpbmcoKS50b0xvd2VyQ2FzZSgpKTtcblx0XHRcdFx0XHRcdFx0XHRcdFx0XHRcdFx0aWYgKGluZGV4b2YgIT09IC0xKSB7XG5cdFx0XHRcdFx0XHRcdFx0XHRcdFx0XHRcdFx0ZmxhZyA9IHRydWU7XG5cdFx0XHRcdFx0XHRcdFx0XHRcdFx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdFx0XHRcdFx0XHRcdFx0XHRcdFx0ZmxhZyA9IGZhbHNlO1xuXHRcdFx0XHRcdFx0XHRcdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XHRcdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XHRcdFx0XHRcdFx0XHRjb250YWluVmFsaWRhdGlvblJlc3BvbnNlLnB1c2goZmxhZyk7XG5cblx0XHRcdFx0XHRcdFx0XHRcdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRcdFx0XHRcdFx0XHRcdFx0JFFKTG9nZ2VyLmxvZyhcIlFKQ0ZpbHRlciAtPiBXYXJuaW5nIC0+IGJpbmRlZEFycmF5SXRlbSBcIiArIGJpbmRUb0ZpZWxkICsgXCIgYXQgaW5kZXggXCIgKyBiaW5kZWRBcnJheUl0ZW1LZXkgKyBcIiBpcyBudWxsIHNvIGl0cyBvbWl0ZWQgZnJvbSBmaWx0ZXJpbmdcIik7XG5cdFx0XHRcdFx0XHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0XHRcdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRcdFx0XHRcdFx0XHRcdCRRSkxvZ2dlci5sb2coXCJRSkNGaWx0ZXIgLT4gV2FybmluZyAtPiBiaW5kZWRBcnJheUl0ZW0gXCIgKyBiaW5kVG9GaWVsZCArIFwiIGRvIG5vdCBleGlzdHMgaW4gXCIgKyBmaWVsZC5hcnJheU5hbWUpO1xuXHRcdFx0XHRcdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XHRcdFx0XHR9KTtcblx0XHRcdFx0XHRcdFx0XHRcdHZhciBwYXNzQ29udGFpblZhbGlkYXRpb24gPSAobnVsbCAhPSBfLmZpbmQoY29udGFpblZhbGlkYXRpb25SZXNwb25zZSwgZnVuY3Rpb24odmFsKSB7XG5cdFx0XHRcdFx0XHRcdFx0XHRcdHJldHVybiB2YWwgPT0gdHJ1ZVxuXHRcdFx0XHRcdFx0XHRcdFx0fSkpO1xuXHRcdFx0XHRcdFx0XHRcdFx0YmluZGVkQXJyYXlJdGVtW3NldHRpbmdzLmZpbHRlcmVkZmllbGROYW1lXSA9ICFwYXNzQ29udGFpblZhbGlkYXRpb247XG5cdFx0XHRcdFx0XHRcdFx0XHRpZiAoY29udGFpblZhbGlkYXRpb25SZXNwb25zZS5sZW5ndGggPT0gMCkge1xuXHRcdFx0XHRcdFx0XHRcdFx0XHRiaW5kZWRBcnJheUl0ZW1bc2V0dGluZ3MuZmlsdGVyZWRmaWVsZE5hbWVdID0gZmFsc2U7IC8vbm8gaHVibyByZXNwdWVzdGFzIHBvciBsbyB0YW50byBubyBzZSBmaWx0cmFcblx0XHRcdFx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcdFx0XHRcdGlmIChiaW5kZWRBcnJheUl0ZW1bc2V0dGluZ3MuZmlsdGVyZWRmaWVsZE5hbWVdKSB7XG5cdFx0XHRcdFx0XHRcdFx0XHRcdGNvbnRhaW5WYWxpZGF0aW9uU3VjY2Vzc0l0ZW1zS2V5cy5wdXNoKGJpbmRlZEFycmF5SXRlbUtleSk7IC8vc2kgc2UgZmlsdHJhIHVuYSB2ZXMganVtcCBwYXJhIGVsIHJlc3RvXG5cdFx0XHRcdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XHRcdFx0fSk7XG5cdFx0XHRcdFx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdFx0XHRcdFx0JFFKTG9nZ2VyLmxvZyhcIlFKQ0ZpbHRlciAtPiBXYXJuaW5nIC0+IGFycmF5TmFtZSBcIiArIGZpZWxkLmFycmF5TmFtZSArIFwiIGZvciBmaWx0ZXIgZmllbGQgXCIgKyBmaWVsZC5uYW1lICsgXCIgZG8gbm90IGV4aXN0cyBvbiB0aGUgc2NvcGVcIik7XG5cdFx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcdH0pO1xuXHRcdFx0XHRcdH0pO1xuXHRcdFx0XHRcdCRzY29wZS4kZW1pdCgncWpjZmlsdGVyLnVwZGF0ZScsIHtcblx0XHRcdFx0XHRcdGZpbHRlcmVkZmllbGROYW1lOiBzZXR0aW5ncy5maWx0ZXJlZGZpZWxkTmFtZVxuXHRcdFx0XHRcdH0pO1xuXHRcdFx0XHR9O1xuXHRcdFx0XHQkc2NvcGUuJHdhdGNoKHNldHRpbmdzLm5hbWUgKyAnLmZpZWxkcycsIGZ1bmN0aW9uKG5ld1ZhbHVlLCBvbGRWYWx1ZSkge1xuXHRcdFx0XHRcdHNlbGYuZmlsdGVyKCk7XG5cdFx0XHRcdH0sIHRydWUpO1xuXHRcdFx0fVxuXHRcdH1cblx0fVxuXSk7XG59KS5jYWxsKHRoaXMscmVxdWlyZShcIis3WkpwMFwiKSx0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30scmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIsYXJndW1lbnRzWzNdLGFyZ3VtZW50c1s0XSxhcmd1bWVudHNbNV0sYXJndW1lbnRzWzZdLFwiLy4uL2NvbnRyb2xzL3FqZmlsdGVyQ3RybC5qc1wiLFwiLy4uL2NvbnRyb2xzXCIpIiwiKGZ1bmN0aW9uIChwcm9jZXNzLGdsb2JhbCxCdWZmZXIsX19hcmd1bWVudDAsX19hcmd1bWVudDEsX19hcmd1bWVudDIsX19hcmd1bWVudDMsX19maWxlbmFtZSxfX2Rpcm5hbWUpe1xudmFyIG1vZHVsZSA9IHJlcXVpcmUoJy4vX21vZHVsZV9pbml0LmpzJyk7XG5tb2R1bGUuZmFjdG9yeSgnJFFKQ0xpc3R2aWV3JywgW1xuXHQnJFFKQXBpJywgJyRRSkhlbHBlckZ1bmN0aW9ucycsICckUUpMb2dnZXInLCAnJHJvb3RTY29wZScsICckc3RhdGUnLCAnJHRpbWVvdXQnLCAnJFFKTG9jYWxTZXNzaW9uJywgJyRRSkF1dGgnLFxuXHRmdW5jdGlvbigkUUpBcGksICRRSkhlbHBlckZ1bmN0aW9ucywgJFFKTG9nZ2VyLCAkcm9vdFNjb3BlLCAkc3RhdGUsICR0aW1lb3V0LCAkUUpMb2NhbFNlc3Npb24sICRRSkF1dGgpIHtcblxuXG5cdFx0ZnVuY3Rpb24gY3JlYXRlUGFnZWRMaXN0KGl0ZW1zLCBlbnRyaWVzUGVyUGFnZSkge1xuXHRcdFx0dmFyIHBhZ2VzQ291bnRlciA9IDE7XG5cdFx0XHR2YXIgcGFnZXMgPSBbXTtcblx0XHRcdC8vXG5cdFx0XHR2YXIgX2N1cnJJdGVtSW5kZXggPSAwO1xuXHRcdFx0dmFyIF9jdXJyUGFnZSA9IFtdO1xuXHRcdFx0d2hpbGUgKF9jdXJySXRlbUluZGV4IDwgaXRlbXMubGVuZ3RoKSB7IC8vZWo6IDAgPCA1XG5cdFx0XHRcdGlmIChfY3VyclBhZ2UubGVuZ3RoIDwgZW50cmllc1BlclBhZ2UpIHtcblx0XHRcdFx0XHRfY3VyclBhZ2UucHVzaChpdGVtc1tfY3Vyckl0ZW1JbmRleF0pO1xuXHRcdFx0XHRcdF9jdXJySXRlbUluZGV4Kys7XG5cdFx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdFx0cGFnZXMucHVzaChfY3VyclBhZ2UpO1xuXHRcdFx0XHRcdF9jdXJyUGFnZSA9IFtdO1xuXHRcdFx0XHRcdHBhZ2VzQ291bnRlcisrO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0XHRpZiAoX2N1cnJQYWdlLmxlbmd0aCA+IDApIHtcblx0XHRcdFx0cGFnZXMucHVzaChfY3VyclBhZ2UpO1xuXHRcdFx0fVxuXHRcdFx0cmV0dXJuIHBhZ2VzO1xuXHRcdH1cblxuXHRcdGZ1bmN0aW9uIGJ1aWxkTGlzdFZpZXdEYXRhKGl0ZW1zKSB7XG5cdFx0XHR2YXIgZW50cmllc1BlclBhZ2UgPSAkcm9vdFNjb3BlLmNvbmZpZy5saXN0dmlld0VudHJpZXNQZXJQYWdlOyAvL2VqOiAyICAgXG5cdFx0XHR2YXIgcGFnZXMgPSBbXTtcblx0XHRcdGlmICghXy5pc1VuZGVmaW5lZChpdGVtcykpIHtcblx0XHRcdFx0cGFnZXMgPSBjcmVhdGVQYWdlZExpc3QoaXRlbXMsIGVudHJpZXNQZXJQYWdlKTtcblx0XHRcdH1cblx0XHRcdHZhciBwYWdlTnVtYmVycyA9IFtdO1xuXHRcdFx0Xy5lYWNoKHBhZ2VzLCBmdW5jdGlvbihlLCBpbmRleCkge1xuXHRcdFx0XHRwYWdlTnVtYmVycy5wdXNoKGluZGV4ICsgMSk7XG5cdFx0XHR9KTtcblx0XHRcdHZhciBfbHZEYXRhID0ge1xuXHRcdFx0XHRjdXJyZW50UGFnZUluZGV4OiAwLFxuXHRcdFx0XHRjdXJyZW50UGFnZTogcGFnZXNbMF0sXG5cdFx0XHRcdHRvdGFsUGFnZXM6IHBhZ2VzLmxlbmd0aCxcblx0XHRcdFx0dG90YWxJdGVtczogaXRlbXMubGVuZ3RoLFxuXHRcdFx0XHRwYWdlczogcGFnZXMsXG5cdFx0XHRcdHBhZ2luYXRpb246IHtcblx0XHRcdFx0XHRwYWdlTnVtYmVyczogcGFnZU51bWJlcnMsXG5cdFx0XHRcdFx0ZGlzYWJsZWRGb3JQcmV2TGluazogZnVuY3Rpb24oKSB7XG5cdFx0XHRcdFx0XHRyZXR1cm4gX2x2RGF0YS5jdXJyZW50UGFnZUluZGV4ID09PSAwID8gdHJ1ZSA6IGZhbHNlO1xuXHRcdFx0XHRcdH0sXG5cdFx0XHRcdFx0ZGlzYWJsZWRGb3JOZXh0TGluazogZnVuY3Rpb24oKSB7XG5cdFx0XHRcdFx0XHRyZXR1cm4gX2x2RGF0YS5jdXJyZW50UGFnZUluZGV4ID49IHBhZ2VzLmxlbmd0aCAtIDEgPyB0cnVlIDogZmFsc2U7XG5cdFx0XHRcdFx0fSxcblx0XHRcdFx0XHRhY3RpdmVGb3JMaW5rOiBmdW5jdGlvbihwYWdlTnVtYmVyKSB7XG5cdFx0XHRcdFx0XHRpZiAoKHBhZ2VOdW1iZXIgPT09IF9sdkRhdGEuY3VycmVudFBhZ2VJbmRleCArIDEpKSB7XG5cdFx0XHRcdFx0XHRcdHJldHVybiB0cnVlO1xuXHRcdFx0XHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0XHRcdFx0cmV0dXJuIGZhbHNlO1xuXHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdH0sXG5cdFx0XHRcdFx0Z290bzogZnVuY3Rpb24ocGFnZU51bWJlcikge1xuXHRcdFx0XHRcdFx0X2x2RGF0YS5jdXJyZW50UGFnZUluZGV4ID0gcGFnZU51bWJlciAtIDE7XG5cdFx0XHRcdFx0XHRfbHZEYXRhLmN1cnJlbnRQYWdlID0gcGFnZXNbX2x2RGF0YS5jdXJyZW50UGFnZUluZGV4XTtcblx0XHRcdFx0XHR9LFxuXHRcdFx0XHRcdG5leHQ6IGZ1bmN0aW9uKCkge1xuXHRcdFx0XHRcdFx0X2x2RGF0YS5jdXJyZW50UGFnZUluZGV4Kys7XG5cdFx0XHRcdFx0XHRpZiAoX2x2RGF0YS5jdXJyZW50UGFnZUluZGV4ID49IHBhZ2VzLmxlbmd0aCkge1xuXHRcdFx0XHRcdFx0XHRfbHZEYXRhLmN1cnJlbnRQYWdlSW5kZXggPSBwYWdlcy5sZW5ndGggLSAxO1xuXHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0X2x2RGF0YS5jdXJyZW50UGFnZSA9IHBhZ2VzW19sdkRhdGEuY3VycmVudFBhZ2VJbmRleF07XG5cdFx0XHRcdFx0fSxcblx0XHRcdFx0XHRwcmV2OiBmdW5jdGlvbigpIHtcblx0XHRcdFx0XHRcdF9sdkRhdGEuY3VycmVudFBhZ2VJbmRleC0tO1xuXHRcdFx0XHRcdFx0aWYgKF9sdkRhdGEuY3VycmVudFBhZ2VJbmRleCA8PSAwKSB7XG5cdFx0XHRcdFx0XHRcdF9sdkRhdGEuY3VycmVudFBhZ2VJbmRleCA9IDA7XG5cdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XHRfbHZEYXRhLmN1cnJlbnRQYWdlID0gcGFnZXNbX2x2RGF0YS5jdXJyZW50UGFnZUluZGV4XTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdH1cblx0XHRcdH07XG5cdFx0XHRyZXR1cm4gX2x2RGF0YTtcblx0XHR9XG5cdFx0cmV0dXJuIHtcblx0XHRcdGNyZWF0ZTogZnVuY3Rpb24oc2V0dGluZ3MsICRzY29wZSkge1xuXHRcdFx0XHQvL2luc3RhbmNlIHByaXZhdGVcblx0XHRcdFx0ZnVuY3Rpb24gcmVuZGVyKGl0ZW1zKSB7XG5cdFx0XHRcdFx0JHNjb3BlW3NldHRpbmdzLnBhZ2VkRGF0YUFycmF5XSA9IGJ1aWxkTGlzdFZpZXdEYXRhKGl0ZW1zKTtcblx0XHRcdFx0fVxuXG5cblxuXHRcdFx0XHQvL3dhdGNoXG5cdFx0XHRcdCRzY29wZS4kd2F0Y2goc2V0dGluZ3MuZGF0YUFycmF5LCBmdW5jdGlvbihuZXdWYWx1ZSwgb2xkVmFsdWUpIHtcblxuXHRcdFx0XHRcdGlmIChfLmlzVW5kZWZpbmVkKCRzY29wZVtzZXR0aW5ncy5kYXRhQXJyYXldKSkge1xuXHRcdFx0XHRcdFx0JFFKTG9nZ2VyLmxvZyhcIldBUk5JTkc6IFFKQ0xpc3R2aWV3IC0+IFwiICsgc2V0dGluZ3MuZGF0YUFycmF5ICsgXCIgLT4gXCIgKyBcIiBkYXRhQXJyYXkgdW5kZWZpbmVkXCIpO1xuXHRcdFx0XHRcdFx0cmV0dXJuO1xuXHRcdFx0XHRcdH1cblxuXHRcdFx0XHRcdCRzY29wZVtzZXR0aW5ncy5wYWdlZERhdGFBcnJheV0gPSBidWlsZExpc3RWaWV3RGF0YSgkc2NvcGVbc2V0dGluZ3MuZGF0YUFycmF5XSk7XG5cdFx0XHRcdFx0cmVuZGVyKCRzY29wZVtzZXR0aW5ncy5kYXRhQXJyYXldKTtcblx0XHRcdFx0fSk7XG5cblxuXHRcdFx0XHQkc2NvcGUuJG9uKCdxamNmaWx0ZXIudXBkYXRlJywgZnVuY3Rpb24oYXJnczEsIGFyZ3MyKSB7XG5cdFx0XHRcdFx0JHNjb3BlLiRlbWl0KHNldHRpbmdzLm5hbWUgKyBcIi51cGRhdGVcIiwge30pO1xuXHRcdFx0XHRcdHZhciBmaWx0ZXJlZERhdGEgPSBfLmZpbHRlcigkc2NvcGVbc2V0dGluZ3MuZGF0YUFycmF5XSwgZnVuY3Rpb24oaXRlbSkge1xuXHRcdFx0XHRcdFx0cmV0dXJuICFpdGVtW2FyZ3MyLmZpbHRlcmVkZmllbGROYW1lXTtcblx0XHRcdFx0XHR9KTtcblx0XHRcdFx0XHRyZW5kZXIoZmlsdGVyZWREYXRhKTtcblxuXHRcdFx0XHRcdHZhciBmaWx0ZXJlZENvdW50ID0gXy5maWx0ZXIoJHNjb3BlW3NldHRpbmdzLmRhdGFBcnJheV0sIGZ1bmN0aW9uKGl0ZW0pIHtcblx0XHRcdFx0XHRcdHJldHVybiBpdGVtW2FyZ3MyLmZpbHRlcmVkZmllbGROYW1lXSA9PSB0cnVlO1xuXHRcdFx0XHRcdH0pO1xuXHRcdFx0XHRcdCRzY29wZS4kZW1pdCgncWpjbGlzdHZpZXcuZmlsdGVyLnN1Y2Nlc3MnLCB7XG5cdFx0XHRcdFx0XHRmaWx0ZXJlZENvdW50OiBmaWx0ZXJlZENvdW50XG5cdFx0XHRcdFx0fSk7XG5cblx0XHRcdFx0fSk7XG5cblx0XHRcdFx0dmFyIHNlbGYgPSBzZXR0aW5ncztcblx0XHRcdFx0JHNjb3BlW3NldHRpbmdzLm5hbWVdID0gc2VsZjtcblxuXHRcdFx0XHRzZWxmLnVwZGF0ZSA9IGZ1bmN0aW9uKCkge1xuXHRcdFx0XHRcdC8vREJcblx0XHRcdFx0XHQkUUpBcGkuZ2V0Q29udHJvbGxlcihzZXR0aW5ncy5hcGkuY29udHJvbGxlcikuZ2V0KHNldHRpbmdzLmFwaS5wYXJhbXMsIGZ1bmN0aW9uKHJlcykge1xuXHRcdFx0XHRcdFx0JFFKTG9nZ2VyLmxvZyhcIlFKQ0xpc3R2aWV3IC0+IFwiICsgc2V0dGluZ3MuYXBpLmNvbnRyb2xsZXIgKyBcIiBcIiArIHNldHRpbmdzLmFwaS5wYXJhbXMuYWN0aW9uICsgXCIgLT4gc3VjY2Vzc1wiKTtcblx0XHRcdFx0XHRcdCRzY29wZVtzZXR0aW5ncy5kYXRhQXJyYXldID0gcmVzLml0ZW1zO1xuXHRcdFx0XHRcdFx0JHNjb3BlLiRlbWl0KHNldHRpbmdzLm5hbWUgKyBcIi51cGRhdGVcIiwge30pO1xuXHRcdFx0XHRcdFx0Ly9jb25zb2xlLmluZm8oJHNjb3BlW3NldHRpbmdzLmRhdGFBcnJheV0pO1xuXHRcdFx0XHRcdH0pO1xuXHRcdFx0XHRcdC8vJHNjb3BlLiRlbWl0KHNldHRpbmdzLm5hbWUrXCIudXBkYXRlXCIse30pO1xuXHRcdFx0XHR9O1xuXHRcdFx0XHRzZWxmLnVwZGF0ZSgpO1xuXG5cblx0XHRcdH1cblx0XHR9O1xuXHR9XG5dKTtcblxuXG5tb2R1bGUuZGlyZWN0aXZlKCdxamNsaXN0dmlldycsIGZ1bmN0aW9uKCkge1xuXHR2YXIgZGlyZWN0aXZlID0ge307XG5cdGRpcmVjdGl2ZS5yZXN0cmljdCA9ICdFJzsgLyogcmVzdHJpY3QgdGhpcyBkaXJlY3RpdmUgdG8gZWxlbWVudHMgKi9cblx0ZGlyZWN0aXZlLnRlbXBsYXRlVXJsID0gXCJwYWdlcy9jb250cm9scy9xamNsaXN0dmlldy5odG1sXCI7XG5cdGRpcmVjdGl2ZS5zY29wZSA9IHtcblx0XHRkYXRhOiBcIj1cIixcblx0XHRsdnc6IFwiPVwiXG5cdH1cblx0ZGlyZWN0aXZlLmNvbXBpbGUgPSBmdW5jdGlvbihlbGVtZW50LCBhdHRyaWJ1dGVzKSB7XG5cdFx0dmFyIGxpbmtGdW5jdGlvbiA9IGZ1bmN0aW9uKCRzY29wZSwgZWxlbWVudCwgYXR0cmlidXRlcykge31cblx0XHRyZXR1cm4gbGlua0Z1bmN0aW9uO1xuXHR9XG5cdHJldHVybiBkaXJlY3RpdmU7XG59KTtcbn0pLmNhbGwodGhpcyxyZXF1aXJlKFwiKzdaSnAwXCIpLHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvLi4vY29udHJvbHMvcWpsaXN0dmlld0N0cmwuanNcIixcIi8uLi9jb250cm9sc1wiKSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbnZhciBtb2R1bGUgPSByZXF1aXJlKCcuL19tb2R1bGVfaW5pdC5qcycpO1xubW9kdWxlLmZhY3RvcnkoJyRRSkNUaW1lQ291bnRlcicsIFtcblx0JyRpbnRlcnZhbCcsICckUUpBcGknLCAnJFFKSGVscGVyRnVuY3Rpb25zJywgJyRRSkxvZ2dlcicsICckcm9vdFNjb3BlJywgJyRzdGF0ZScsICckdGltZW91dCcsICckUUpMb2NhbFNlc3Npb24nLCAnJFFKQXV0aCcsXG5cdGZ1bmN0aW9uKCRpbnRlcnZhbCwgJFFKQXBpLCAkUUpIZWxwZXJGdW5jdGlvbnMsICRRSkxvZ2dlciwgJHJvb3RTY29wZSwgJHN0YXRlLCAkdGltZW91dCwgJFFKTG9jYWxTZXNzaW9uLCAkUUpBdXRoKSB7XG5cdFx0cmV0dXJuIHtcblx0XHRcdGNyZWF0ZTogZnVuY3Rpb24oc2V0dGluZ3MsICRzY29wZSkge1xuXHRcdFx0XHR2YXIgc2VsZiA9IF8uZXh0ZW5kKHNldHRpbmdzLCB7XG5cdFx0XHRcdFx0d29ya2luZzogZmFsc2UsXG5cdFx0XHRcdFx0cHJvamVjdDogXCJub25lXCIsXG5cdFx0XHRcdFx0c3RhcnRUaW1lRm9ybWF0ZWQ6IG51bGwsXG5cdFx0XHRcdFx0ZW5kVGltZUZvcm1hdGVkOiBudWxsLFxuXHRcdFx0XHRcdGVycm9yczogW10sXG5cdFx0XHRcdFx0Y2FsbGluZ0FwaTogZmFsc2Vcblx0XHRcdFx0fSk7XG5cdFx0XHRcdHNlbGYuYWRkRXJyb3IgPSBmdW5jdGlvbihlcnJvcikge1xuXHRcdFx0XHRcdHNlbGYuZXJyb3JzLnB1c2goZXJyb3IpO1xuXHRcdFx0XHRcdCR0aW1lb3V0KGZ1bmN0aW9uKCkge1xuXHRcdFx0XHRcdFx0JHNjb3BlLiRhcHBseShmdW5jdGlvbigpIHtcblx0XHRcdFx0XHRcdFx0c2VsZi5lcnJvcnMgPSBbXTtcblx0XHRcdFx0XHRcdH0pO1xuXHRcdFx0XHRcdH0sIDIwMDApO1xuXHRcdFx0XHR9O1xuXHRcdFx0XHRzZWxmLnJlc3RhcnQgPSBmdW5jdGlvbigpIHtcblx0XHRcdFx0XHRzZWxmLnN0YXJ0VGltZUZvcm1hdGVkID0gbnVsbDtcblx0XHRcdFx0XHRzZWxmLmVuZFRpbWVGb3JtYXRlZCA9IG51bGw7XG5cdFx0XHRcdFx0c2VsZi5lcnJvcnMgPSBbXTtcblx0XHRcdFx0XHRzZWxmLmRpZmZGb3JtYXRlZCA9IG51bGw7XG5cdFx0XHRcdH07XG5cdFx0XHRcdHNlbGYuaW5pdCA9IGZ1bmN0aW9uKCkge1xuXHRcdFx0XHRcdGlmIChzZWxmLmNhbGxpbmdBcGkpIHJldHVybjsgLy9jYWxsaW5nIGFweSBzeW5jIHBsZWFzZS5cblx0XHRcdFx0XHRzZWxmLnJlc3RhcnQoKTtcblx0XHRcdFx0XHRzZWxmLmNhbGxpbmdBcGkgPSB0cnVlO1xuXHRcdFx0XHRcdCRRSkFwaS5nZXRDb250cm9sbGVyKHNldHRpbmdzLmFwaS5jb250cm9sbGVyKS5nZXQoc2V0dGluZ3MuYXBpLnBhcmFtcywgZnVuY3Rpb24ocmVzKSB7XG5cdFx0XHRcdFx0XHRzZWxmLmNhbGxpbmdBcGkgPSBmYWxzZTtcblx0XHRcdFx0XHRcdCRRSkxvZ2dlci5sb2coXCJRSkNUaW1lQ291bnRlciAtPiBcIiArIEpTT04uc3RyaW5naWZ5KHNldHRpbmdzLmFwaSkgKyBcIiAtPiBzdWNjZXNzXCIpO1xuXHRcdFx0XHRcdFx0c2VsZi53b3JraW5nID0gKHJlcy5pdGVtICE9IG51bGwpO1xuXHRcdFx0XHRcdFx0c2VsZi5yZXNpdGVtID0gcmVzLml0ZW07XG5cdFx0XHRcdFx0XHRpZiAoIV8uaXNVbmRlZmluZWQoc2V0dGluZ3Mub25Jbml0KSkge1xuXHRcdFx0XHRcdFx0XHRzZXR0aW5ncy5vbkluaXQoc2VsZik7XG5cdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0fSk7XG5cdFx0XHRcdFx0cmV0dXJuIHNlbGY7XG5cdFx0XHRcdH07XG5cdFx0XHRcdHNlbGYuZ2V0VGltZSA9IGZ1bmN0aW9uKCkge1xuXHRcdFx0XHRcdHJldHVybiBuZXcgRGF0ZSgpLmdldFRpbWUoKTtcblx0XHRcdFx0fTtcblx0XHRcdFx0c2VsZi5nZXRUaW1lRm9ybWF0ZWQgPSBmdW5jdGlvbigpIHtcblx0XHRcdFx0XHRyZXR1cm4gbW9tZW50KHNlbGYuZ2V0VGltZSgpKS5mb3JtYXQoXCJkZGRkLCBNTU1NIERvIFlZWVksIGg6bW06c3MgYVwiKTtcblx0XHRcdFx0fTtcblx0XHRcdFx0c2VsZi5nZXREaWZmID0gZnVuY3Rpb24obWlsbGkpIHtcblx0XHRcdFx0XHR2YXIgYWN0dWFsID0gc2VsZi5nZXRUaW1lKCk7XG5cdFx0XHRcdFx0cmV0dXJuIChhY3R1YWwgLSBtaWxsaSk7XG5cdFx0XHRcdH07XG5cdFx0XHRcdHNlbGYuZ2V0RGlmZkZvcm1hdGVkID0gZnVuY3Rpb24obWlsbGkpIHtcblx0XHRcdFx0XHR2YXIgZGlmZiA9IHNlbGYuZ2V0RGlmZihtaWxsaSk7XG5cdFx0XHRcdFx0dmFyIGR1cmF0aW9uID0ge1xuXHRcdFx0XHRcdFx0aG91cnM6IE1hdGgucm91bmQoKGRpZmYgLyAxMDAwIC8gNjAgLyA2MCkgJSAyNCksXG5cdFx0XHRcdFx0XHRtaW51dGVzOiBNYXRoLnJvdW5kKChkaWZmIC8gMTAwMCAvIDYwKSAlIDYwKSxcblx0XHRcdFx0XHRcdHNlY29uZHM6IE1hdGgucm91bmQoKGRpZmYgLyAxMDAwKSAlIDYwKVxuXHRcdFx0XHRcdH07XG5cdFx0XHRcdFx0dmFyIHN0ciA9IFwiXCI7XG5cdFx0XHRcdFx0c3RyICs9IGR1cmF0aW9uLmhvdXJzICsgXCIgaG91cnMsIFwiO1xuXHRcdFx0XHRcdHN0ciArPSBkdXJhdGlvbi5taW51dGVzICsgXCIgbWlucywgXCI7XG5cdFx0XHRcdFx0c3RyICs9IGR1cmF0aW9uLnNlY29uZHMgKyBcIiBzZWNzLCBcIjtcblx0XHRcdFx0XHQvL3N0ciArPSBkaWZmICsgXCIgdG90YWwsIFwiO1xuXHRcdFx0XHRcdHJldHVybiBzdHI7XG5cdFx0XHRcdH07XG5cdFx0XHRcdHNlbGYudmFsaWRhdGVTdGFydCA9IGZ1bmN0aW9uKCkge1xuXHRcdFx0XHRcdGlmICghXy5pc1VuZGVmaW5lZChzZXR0aW5ncy5vblZhbGlkYXRlU3RhcnQpKSB7XG5cdFx0XHRcdFx0XHRyZXR1cm4gc2V0dGluZ3Mub25WYWxpZGF0ZVN0YXJ0KHNlbGYpO1xuXHRcdFx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdFx0XHRyZXR1cm4gdHJ1ZTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdH07XG5cdFx0XHRcdHNlbGYucmVzdW1lID0gZnVuY3Rpb24oZnJvbSkge1xuXHRcdFx0XHRcdHNlbGYuc3RhcnQoZnJvbSk7XG5cdFx0XHRcdH07XG5cdFx0XHRcdHNlbGYuc3RhcnQgPSBmdW5jdGlvbihzdGFydCkge1xuXHRcdFx0XHRcdGlmICghc2VsZi52YWxpZGF0ZVN0YXJ0KCkpIHtcblx0XHRcdFx0XHRcdHJldHVybjtcblx0XHRcdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRcdFx0Ly9jb25zb2xlLmluZm8oXCJUSU1FUiBTVEFSVEVEIEZBSUxcIik7XG5cdFx0XHRcdFx0fVxuXG5cdFx0XHRcdFx0Ly9cblx0XHRcdFx0XHQvL2NvbnNvbGUuaW5mbyhcIlRJTUVSIFNUQVJURURcIik7XG5cblx0XHRcdFx0XHRpZiAoc3RhcnQgJiYgc3RhcnQubGVuZ3RoID4gMCkge1xuXHRcdFx0XHRcdFx0c2VsZi5fc3RhcnRWYWwgPSBwYXJzZUludChzdGFydCk7XG5cdFx0XHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0XHRcdHNlbGYuX3N0YXJ0VmFsID0gc2VsZi5nZXRUaW1lKCk7IC8vc3RhcnQgc2V0dGVkXHRcblx0XHRcdFx0XHR9XG5cblx0XHRcdFx0XHRpZiAoIV8uaXNVbmRlZmluZWQoc2V0dGluZ3Mub25TdGFydENoYW5nZSkpIHtcblx0XHRcdFx0XHRcdHNldHRpbmdzLm9uU3RhcnRDaGFuZ2Uoc2VsZi5fc3RhcnRWYWwsIHNlbGYpO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0XHRzZWxmLnN0YXJ0VGltZUZvcm1hdGVkID0gc2VsZi5nZXRUaW1lRm9ybWF0ZWQoKTsgLy9zdGFydCBmb3JtYXRlZCBzZXR0ZWRcblx0XHRcdFx0XHRzZWxmLmVuZFRpbWVGb3JtYXRlZCA9IHNlbGYuc3RhcnRUaW1lRm9ybWF0ZWQ7IC8vZW5kIHNldHRlZFxuXHRcdFx0XHRcdHNlbGYuZGlmZiA9IHNlbGYuZ2V0RGlmZihzZWxmLl9zdGFydFZhbCk7XG5cdFx0XHRcdFx0c2VsZi5kaWZmRm9ybWF0ZWQgPSBzZWxmLmdldERpZmZGb3JtYXRlZChzZWxmLl9zdGFydFZhbCk7XG5cdFx0XHRcdFx0aWYgKCFfLmlzVW5kZWZpbmVkKHNldHRpbmdzLm9uRGlmZkNoYW5nZSkpIHtcblx0XHRcdFx0XHRcdHNldHRpbmdzLm9uRGlmZkNoYW5nZShzZWxmLmRpZmYsIHNlbGYuZGlmZkZvcm1hdGVkLCBzZWxmKTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0c2VsZi53b3JraW5nSW50ZXJ2YWwgPSAkaW50ZXJ2YWwoZnVuY3Rpb24oKSB7XG5cdFx0XHRcdFx0XHRpZiAoIXNlbGYud29ya2luZykgcmV0dXJuO1xuXHRcdFx0XHRcdFx0c2VsZi5fc3RvcFZhbCA9IHNlbGYuZ2V0VGltZSgpO1xuXHRcdFx0XHRcdFx0aWYgKCFfLmlzVW5kZWZpbmVkKHNldHRpbmdzLm9uU3RvcENoYW5nZSkpIHtcblx0XHRcdFx0XHRcdFx0c2V0dGluZ3Mub25TdG9wQ2hhbmdlKHNlbGYuX3N0b3BWYWwsIHNlbGYpO1xuXHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0c2VsZi5lbmRUaW1lRm9ybWF0ZWQgPSBzZWxmLmdldFRpbWVGb3JtYXRlZCgpO1xuXHRcdFx0XHRcdFx0c2VsZi5kaWZmID0gc2VsZi5nZXREaWZmKHNlbGYuX3N0YXJ0VmFsKTtcblx0XHRcdFx0XHRcdHNlbGYuZGlmZkZvcm1hdGVkID0gc2VsZi5nZXREaWZmRm9ybWF0ZWQoc2VsZi5fc3RhcnRWYWwpO1xuXHRcdFx0XHRcdFx0aWYgKCFfLmlzVW5kZWZpbmVkKHNldHRpbmdzLm9uRGlmZkNoYW5nZSkpIHtcblx0XHRcdFx0XHRcdFx0c2V0dGluZ3Mub25EaWZmQ2hhbmdlKHNlbGYuZGlmZiwgc2VsZi5kaWZmRm9ybWF0ZWQsIHNlbGYpO1xuXHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdH0sIDEwMDApO1xuXHRcdFx0XHRcdHNlbGYud29ya2luZyA9IHRydWU7XG5cdFx0XHRcdFx0aWYgKCFfLmlzVW5kZWZpbmVkKHNldHRpbmdzLm9uU3RhcnRDbGljaykpIHtcblx0XHRcdFx0XHRcdHNldHRpbmdzLm9uU3RhcnRDbGljayhzZWxmKTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdH07XG5cdFx0XHRcdHNlbGYuc3RvcCA9IGZ1bmN0aW9uKCkge1xuXHRcdFx0XHRcdHNlbGYud29ya2luZyA9IGZhbHNlO1xuXHRcdFx0XHRcdCRpbnRlcnZhbC5jYW5jZWwoc2VsZi53b3JraW5nSW50ZXJ2YWwpO1xuXHRcdFx0XHRcdGlmICghXy5pc1VuZGVmaW5lZChzZXR0aW5ncy5vblN0b3BDbGljaykpIHtcblx0XHRcdFx0XHRcdHNldHRpbmdzLm9uU3RvcENsaWNrKHNlbGYpO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fTtcblx0XHRcdFx0JHNjb3BlW3NldHRpbmdzLm5hbWVdID0gc2VsZjtcblx0XHRcdFx0cmV0dXJuIHNlbGY7XG5cdFx0XHR9XG5cdFx0fTtcblx0fVxuXSk7XG59KS5jYWxsKHRoaXMscmVxdWlyZShcIis3WkpwMFwiKSx0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30scmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIsYXJndW1lbnRzWzNdLGFyZ3VtZW50c1s0XSxhcmd1bWVudHNbNV0sYXJndW1lbnRzWzZdLFwiLy4uL2NvbnRyb2xzL3FqdGltZXJjb3VudGVyQ3RybC5qc1wiLFwiLy4uL2NvbnRyb2xzXCIpIiwiKGZ1bmN0aW9uIChwcm9jZXNzLGdsb2JhbCxCdWZmZXIsX19hcmd1bWVudDAsX19hcmd1bWVudDEsX19hcmd1bWVudDIsX19hcmd1bWVudDMsX19maWxlbmFtZSxfX2Rpcm5hbWUpe1xubW9kdWxlLmV4cG9ydHMgPSBhbmd1bGFyLm1vZHVsZSgnYXBwLmRpcmVjdGl2ZXMnLCBbXSk7XG5yZXF1aXJlKCcuL25nZW50ZXJEaXJlY3RpdmUuanMnKTtcbnJlcXVpcmUoJy4vcWphcGlpbmZvRGlyZWN0aXZlLmpzJyk7XG5yZXF1aXJlKCcuL3FqYnJlYWRjcnVtYkRpcmVjdGl2ZS5qcycpO1xufSkuY2FsbCh0aGlzLHJlcXVpcmUoXCIrN1pKcDBcIiksdHlwZW9mIHNlbGYgIT09IFwidW5kZWZpbmVkXCIgPyBzZWxmIDogdHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiA/IHdpbmRvdyA6IHt9LHJlcXVpcmUoXCJidWZmZXJcIikuQnVmZmVyLGFyZ3VtZW50c1szXSxhcmd1bWVudHNbNF0sYXJndW1lbnRzWzVdLGFyZ3VtZW50c1s2XSxcIi8uLi9kaXJlY3RpdmVzL19tb2R1bGVfaW5pdC5qc1wiLFwiLy4uL2RpcmVjdGl2ZXNcIikiLCIoZnVuY3Rpb24gKHByb2Nlc3MsZ2xvYmFsLEJ1ZmZlcixfX2FyZ3VtZW50MCxfX2FyZ3VtZW50MSxfX2FyZ3VtZW50MixfX2FyZ3VtZW50MyxfX2ZpbGVuYW1lLF9fZGlybmFtZSl7XG52YXIgbW9kdWxlID0gcmVxdWlyZSgnLi9fbW9kdWxlX2luaXQuanMnKTtcbm1vZHVsZS5kaXJlY3RpdmUoJ25nRW50ZXInLCBmdW5jdGlvbigpIHtcblx0cmV0dXJuIGZ1bmN0aW9uKHNjb3BlLCBlbGVtZW50LCBhdHRycykge1xuXHRcdGVsZW1lbnQuYmluZChcImtleWRvd24ga2V5cHJlc3NcIiwgZnVuY3Rpb24oZXZlbnQpIHtcblx0XHRcdGlmIChldmVudC53aGljaCA9PT0gMTMpIHtcblx0XHRcdFx0c2NvcGUuJGFwcGx5KGZ1bmN0aW9uKCkge1xuXHRcdFx0XHRcdHNjb3BlLiRldmFsKGF0dHJzLm5nRW50ZXIpO1xuXHRcdFx0XHR9KTtcblxuXHRcdFx0XHRldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuXHRcdFx0fVxuXHRcdH0pO1xuXHR9O1xufSk7XG59KS5jYWxsKHRoaXMscmVxdWlyZShcIis3WkpwMFwiKSx0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30scmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIsYXJndW1lbnRzWzNdLGFyZ3VtZW50c1s0XSxhcmd1bWVudHNbNV0sYXJndW1lbnRzWzZdLFwiLy4uL2RpcmVjdGl2ZXMvbmdlbnRlckRpcmVjdGl2ZS5qc1wiLFwiLy4uL2RpcmVjdGl2ZXNcIikiLCIoZnVuY3Rpb24gKHByb2Nlc3MsZ2xvYmFsLEJ1ZmZlcixfX2FyZ3VtZW50MCxfX2FyZ3VtZW50MSxfX2FyZ3VtZW50MixfX2FyZ3VtZW50MyxfX2ZpbGVuYW1lLF9fZGlybmFtZSl7XG52YXIgbW9kdWxlID0gcmVxdWlyZSgnLi9fbW9kdWxlX2luaXQuanMnKTtcbi8vXG5tb2R1bGUuZGlyZWN0aXZlKCdxamFwaWluZm8nLCBmdW5jdGlvbigpIHtcblx0dmFyIGRpcmVjdGl2ZSA9IHt9O1xuXHRkaXJlY3RpdmUucmVzdHJpY3QgPSAnRSc7IC8qIHJlc3RyaWN0IHRoaXMgZGlyZWN0aXZlIHRvIGVsZW1lbnRzICovXG5cdGRpcmVjdGl2ZS50ZW1wbGF0ZVVybCA9IFwicGFnZXMvY29udHJvbHMvcWphcGlpbmZvLmh0bWxcIjtcblx0ZGlyZWN0aXZlLmNvbXBpbGUgPSBmdW5jdGlvbihlbGVtZW50LCBhdHRyaWJ1dGVzKSB7XG5cdFx0dmFyIGxpbmtGdW5jdGlvbiA9IGZ1bmN0aW9uKCRzY29wZSwgZWxlbWVudCwgYXR0cmlidXRlcykge31cblx0XHRyZXR1cm4gbGlua0Z1bmN0aW9uO1xuXHR9XG5cdHJldHVybiBkaXJlY3RpdmU7XG59KTtcbn0pLmNhbGwodGhpcyxyZXF1aXJlKFwiKzdaSnAwXCIpLHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvLi4vZGlyZWN0aXZlcy9xamFwaWluZm9EaXJlY3RpdmUuanNcIixcIi8uLi9kaXJlY3RpdmVzXCIpIiwiKGZ1bmN0aW9uIChwcm9jZXNzLGdsb2JhbCxCdWZmZXIsX19hcmd1bWVudDAsX19hcmd1bWVudDEsX19hcmd1bWVudDIsX19hcmd1bWVudDMsX19maWxlbmFtZSxfX2Rpcm5hbWUpe1xudmFyIG1vZHVsZSA9IHJlcXVpcmUoJy4vX21vZHVsZV9pbml0LmpzJyk7XG4vL1xubW9kdWxlLmRpcmVjdGl2ZSgncWpicmVhZGNydW1iJywgZnVuY3Rpb24oJFFKSGVscGVyRnVuY3Rpb25zKSB7XG5cdHZhciBkaXJlY3RpdmUgPSB7fTtcblx0ZGlyZWN0aXZlLnJlc3RyaWN0ID0gJ0UnOyAvKiByZXN0cmljdCB0aGlzIGRpcmVjdGl2ZSB0byBlbGVtZW50cyAqL1xuXHRkaXJlY3RpdmUudGVtcGxhdGVVcmwgPSBcInBhZ2VzL21vZHVsZV9kaXJlY3RpdmVzL21vZHVsZS5icmVhZGNydW1iLmRpcmVjdGl2ZS5odG1sXCI7XG5cdGRpcmVjdGl2ZS5zY29wZSA9IHtcblx0XHRkYXRhOiBcIj1cIlxuXHR9XG5cdGRpcmVjdGl2ZS5jb21waWxlID0gZnVuY3Rpb24oZWxlbWVudCwgYXR0cmlidXRlcykge1xuXHRcdHZhciBsaW5rRnVuY3Rpb24gPSBmdW5jdGlvbigkc2NvcGUsIGVsZW1lbnQsIGF0dHJpYnV0ZXMpIHtcblxuXHRcdFx0JHNjb3BlLmRhdGEuZ290byA9IGZ1bmN0aW9uKGl0ZW0pIHtcblx0XHRcdFx0JFFKSGVscGVyRnVuY3Rpb25zLmNoYW5nZVN0YXRlKGl0ZW0uc3RhdGUsIGl0ZW0ucGFyYW1zKTtcblx0XHRcdH07XG5cblx0XHR9XG5cdFx0cmV0dXJuIGxpbmtGdW5jdGlvbjtcblx0fVxuXHRyZXR1cm4gZGlyZWN0aXZlO1xufSk7XG59KS5jYWxsKHRoaXMscmVxdWlyZShcIis3WkpwMFwiKSx0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30scmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIsYXJndW1lbnRzWzNdLGFyZ3VtZW50c1s0XSxhcmd1bWVudHNbNV0sYXJndW1lbnRzWzZdLFwiLy4uL2RpcmVjdGl2ZXMvcWpicmVhZGNydW1iRGlyZWN0aXZlLmpzXCIsXCIvLi4vZGlyZWN0aXZlc1wiKSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbi8qIVxuICogQXV0aG9yOiBBYmR1bGxhaCBBIEFsbXNhZWVkXG4gKiBEYXRlOiA0IEphbiAyMDE0XG4gKiBEZXNjcmlwdGlvbjpcbiAqICAgICAgVGhpcyBmaWxlIHNob3VsZCBiZSBpbmNsdWRlZCBpbiBhbGwgcGFnZXNcbiAhKiovXG5cbi8qXG4gKiBHbG9iYWwgdmFyaWFibGVzLiBJZiB5b3UgY2hhbmdlIGFueSBvZiB0aGVzZSB2YXJzLCBkb24ndCBmb3JnZXQgXG4gKiB0byBjaGFuZ2UgdGhlIHZhbHVlcyBpbiB0aGUgbGVzcyBmaWxlcyFcbiAqL1xudmFyIGxlZnRfc2lkZV93aWR0aCA9IDIyMDsgLy9TaWRlYmFyIHdpZHRoIGluIHBpeGVsc1xuXG4kKGZ1bmN0aW9uKCkge1xuICAgIFwidXNlIHN0cmljdFwiO1xuXG4gICAgLy9FbmFibGUgc2lkZWJhciB0b2dnbGVcbiAgICAkKFwiW2RhdGEtdG9nZ2xlPSdvZmZjYW52YXMnXVwiKS5jbGljayhmdW5jdGlvbihlKSB7XG4gICAgICAgIGUucHJldmVudERlZmF1bHQoKTtcblxuICAgICAgICAvL0lmIHdpbmRvdyBpcyBzbWFsbCBlbm91Z2gsIGVuYWJsZSBzaWRlYmFyIHB1c2ggbWVudVxuICAgICAgICBpZiAoJCh3aW5kb3cpLndpZHRoKCkgPD0gOTkyKSB7XG4gICAgICAgICAgICAkKCcucm93LW9mZmNhbnZhcycpLnRvZ2dsZUNsYXNzKCdhY3RpdmUnKTtcbiAgICAgICAgICAgICQoJy5sZWZ0LXNpZGUnKS5yZW1vdmVDbGFzcyhcImNvbGxhcHNlLWxlZnRcIik7XG4gICAgICAgICAgICAkKFwiLnJpZ2h0LXNpZGVcIikucmVtb3ZlQ2xhc3MoXCJzdHJlY2hcIik7XG4gICAgICAgICAgICAkKCcucm93LW9mZmNhbnZhcycpLnRvZ2dsZUNsYXNzKFwicmVsYXRpdmVcIik7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvL0Vsc2UsIGVuYWJsZSBjb250ZW50IHN0cmVjaGluZ1xuICAgICAgICAgICAgJCgnLmxlZnQtc2lkZScpLnRvZ2dsZUNsYXNzKFwiY29sbGFwc2UtbGVmdFwiKTtcbiAgICAgICAgICAgICQoXCIucmlnaHQtc2lkZVwiKS50b2dnbGVDbGFzcyhcInN0cmVjaFwiKTtcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy9BZGQgaG92ZXIgc3VwcG9ydCBmb3IgdG91Y2ggZGV2aWNlc1xuICAgICQoJy5idG4nKS5iaW5kKCd0b3VjaHN0YXJ0JywgZnVuY3Rpb24oKSB7XG4gICAgICAgICQodGhpcykuYWRkQ2xhc3MoJ2hvdmVyJyk7XG4gICAgfSkuYmluZCgndG91Y2hlbmQnLCBmdW5jdGlvbigpIHtcbiAgICAgICAgJCh0aGlzKS5yZW1vdmVDbGFzcygnaG92ZXInKTtcbiAgICB9KTtcblxuICAgIC8vQWN0aXZhdGUgdG9vbHRpcHNcbiAgICAkKFwiW2RhdGEtdG9nZ2xlPSd0b29sdGlwJ11cIikudG9vbHRpcCgpO1xuXG4gICAgLyogICAgIFxuICAgICAqIEFkZCBjb2xsYXBzZSBhbmQgcmVtb3ZlIGV2ZW50cyB0byBib3hlc1xuICAgICAqL1xuICAgICQoXCJbZGF0YS13aWRnZXQ9J2NvbGxhcHNlJ11cIikuY2xpY2soZnVuY3Rpb24oKSB7XG4gICAgICAgIC8vRmluZCB0aGUgYm94IHBhcmVudCAgICAgICAgXG4gICAgICAgIHZhciBib3ggPSAkKHRoaXMpLnBhcmVudHMoXCIuYm94XCIpLmZpcnN0KCk7XG4gICAgICAgIC8vRmluZCB0aGUgYm9keSBhbmQgdGhlIGZvb3RlclxuICAgICAgICB2YXIgYmYgPSBib3guZmluZChcIi5ib3gtYm9keSwgLmJveC1mb290ZXJcIik7XG4gICAgICAgIGlmICghYm94Lmhhc0NsYXNzKFwiY29sbGFwc2VkLWJveFwiKSkge1xuICAgICAgICAgICAgYm94LmFkZENsYXNzKFwiY29sbGFwc2VkLWJveFwiKTtcbiAgICAgICAgICAgIGJmLnNsaWRlVXAoKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGJveC5yZW1vdmVDbGFzcyhcImNvbGxhcHNlZC1ib3hcIik7XG4gICAgICAgICAgICBiZi5zbGlkZURvd24oKTtcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgLypcbiAgICAgKiBBREQgU0xJTVNDUk9MTCBUTyBUSEUgVE9QIE5BViBEUk9QRE9XTlNcbiAgICAgKiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICAgKi9cbiAgICAkKFwiLm5hdmJhciAubWVudVwiKS5zbGltc2Nyb2xsKHtcbiAgICAgICAgaGVpZ2h0OiBcIjIwMHB4XCIsXG4gICAgICAgIGFsd2F5c1Zpc2libGU6IGZhbHNlLFxuICAgICAgICBzaXplOiBcIjNweFwiXG4gICAgfSkuY3NzKFwid2lkdGhcIiwgXCIxMDAlXCIpO1xuXG4gICAgLypcbiAgICAgKiBJTklUSUFMSVpFIEJVVFRPTiBUT0dHTEVcbiAgICAgKiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICAgKi9cbiAgICAkKCcuYnRuLWdyb3VwW2RhdGEtdG9nZ2xlPVwiYnRuLXRvZ2dsZVwiXScpLmVhY2goZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciBncm91cCA9ICQodGhpcyk7XG4gICAgICAgICQodGhpcykuZmluZChcIi5idG5cIikuY2xpY2soZnVuY3Rpb24oZSkge1xuICAgICAgICAgICAgZ3JvdXAuZmluZChcIi5idG4uYWN0aXZlXCIpLnJlbW92ZUNsYXNzKFwiYWN0aXZlXCIpO1xuICAgICAgICAgICAgJCh0aGlzKS5hZGRDbGFzcyhcImFjdGl2ZVwiKTtcbiAgICAgICAgICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgfSk7XG5cbiAgICB9KTtcblxuICAgICQoXCJbZGF0YS13aWRnZXQ9J3JlbW92ZSddXCIpLmNsaWNrKGZ1bmN0aW9uKCkge1xuICAgICAgICAvL0ZpbmQgdGhlIGJveCBwYXJlbnQgICAgICAgIFxuICAgICAgICB2YXIgYm94ID0gJCh0aGlzKS5wYXJlbnRzKFwiLmJveFwiKS5maXJzdCgpO1xuICAgICAgICBib3guc2xpZGVVcCgpO1xuICAgIH0pO1xuXG4gICAgLyogU2lkZWJhciB0cmVlIHZpZXcgKi9cbiAgICAkKFwiLnNpZGViYXIgLnRyZWV2aWV3XCIpLnRyZWUoKTtcblxuICAgIC8qIFxuICAgICAqIE1ha2Ugc3VyZSB0aGF0IHRoZSBzaWRlYmFyIGlzIHN0cmVjaGVkIGZ1bGwgaGVpZ2h0XG4gICAgICogLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgICogV2UgYXJlIGdvbm5hIGFzc2lnbiBhIG1pbi1oZWlnaHQgdmFsdWUgZXZlcnkgdGltZSB0aGVcbiAgICAgKiB3cmFwcGVyIGdldHMgcmVzaXplZCBhbmQgdXBvbiBwYWdlIGxvYWQuIFdlIHdpbGwgdXNlXG4gICAgICogQmVuIEFsbWFuJ3MgbWV0aG9kIGZvciBkZXRlY3RpbmcgdGhlIHJlc2l6ZSBldmVudC5cbiAgICAgKiBcbiAgICAgKiovXG4gICAgZnVuY3Rpb24gX2ZpeCgpIHtcbiAgICAgICAgLy9HZXQgd2luZG93IGhlaWdodCBhbmQgdGhlIHdyYXBwZXIgaGVpZ2h0XG4gICAgICAgIHZhciBoZWlnaHQgPSAkKHdpbmRvdykuaGVpZ2h0KCkgLSAkKFwiYm9keSA+IC5oZWFkZXJcIikuaGVpZ2h0KCk7XG4gICAgICAgICQoXCIud3JhcHBlclwiKS5jc3MoXCJtaW4taGVpZ2h0XCIsIGhlaWdodCArIFwicHhcIik7XG4gICAgICAgIHZhciBjb250ZW50ID0gJChcIi5yaWdodC1zaWRlXCIpLmhlaWdodCgpO1xuICAgICAgICAvL0lmIHRoZSB3cmFwcGVyIGhlaWdodCBpcyBncmVhdGVyIHRoYW4gdGhlIHdpbmRvd1xuICAgICAgICBpZiAoY29udGVudCA+IGhlaWdodClcbiAgICAgICAgICAgIC8vdGhlbiBzZXQgc2lkZWJhciBoZWlnaHQgdG8gdGhlIHdyYXBwZXJcbiAgICAgICAgICAgICQoXCIubGVmdC1zaWRlLCBodG1sLCBib2R5XCIpLmNzcyhcIm1pbi1oZWlnaHRcIiwgY29udGVudCArIFwicHhcIik7XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgLy9PdGhlcndpc2UsIHNldCB0aGUgc2lkZWJhciB0byB0aGUgaGVpZ2h0IG9mIHRoZSB3aW5kb3dcbiAgICAgICAgICAgICQoXCIubGVmdC1zaWRlLCBodG1sLCBib2R5XCIpLmNzcyhcIm1pbi1oZWlnaHRcIiwgaGVpZ2h0ICsgXCJweFwiKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICAvL0ZpcmUgdXBvbiBsb2FkXG4gICAgX2ZpeCgpO1xuICAgIC8vRmlyZSB3aGVuIHdyYXBwZXIgaXMgcmVzaXplZFxuICAgICQoXCIud3JhcHBlclwiKS5yZXNpemUoZnVuY3Rpb24oKSB7XG4gICAgICAgIF9maXgoKTtcbiAgICAgICAgZml4X3NpZGViYXIoKTtcbiAgICB9KTtcblxuICAgIC8vRml4IHRoZSBmaXhlZCBsYXlvdXQgc2lkZWJhciBzY3JvbGwgYnVnXG4gICAgZml4X3NpZGViYXIoKTtcblxuICAgIC8qXG4gICAgICogV2UgYXJlIGdvbm5hIGluaXRpYWxpemUgYWxsIGNoZWNrYm94IGFuZCByYWRpbyBpbnB1dHMgdG8gXG4gICAgICogaUNoZWNrIHBsdWdpbiBpbi5cbiAgICAgKiBZb3UgY2FuIGZpbmQgdGhlIGRvY3VtZW50YXRpb24gYXQgaHR0cDovL2Zyb250ZWVkLmNvbS9pQ2hlY2svXG4gICAgICovXG4gICAgJChcImlucHV0W3R5cGU9J2NoZWNrYm94J10sIGlucHV0W3R5cGU9J3JhZGlvJ11cIikuaUNoZWNrKHtcbiAgICAgICAgY2hlY2tib3hDbGFzczogJ2ljaGVja2JveF9taW5pbWFsJyxcbiAgICAgICAgcmFkaW9DbGFzczogJ2lyYWRpb19taW5pbWFsJ1xuICAgIH0pO1xuXG59KTtcbmZ1bmN0aW9uIGZpeF9zaWRlYmFyKCkge1xuICAgIC8vTWFrZSBzdXJlIHRoZSBib2R5IHRhZyBoYXMgdGhlIC5maXhlZCBjbGFzc1xuICAgIGlmICghJChcImJvZHlcIikuaGFzQ2xhc3MoXCJmaXhlZFwiKSkge1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy9BZGQgc2xpbXNjcm9sbFxuICAgICQoXCIuc2lkZWJhclwiKS5zbGltc2Nyb2xsKHtcbiAgICAgICAgaGVpZ2h0OiAoJCh3aW5kb3cpLmhlaWdodCgpIC0gJChcIi5oZWFkZXJcIikuaGVpZ2h0KCkpICsgXCJweFwiLFxuICAgICAgICBjb2xvcjogXCJyZ2JhKDAsMCwwLDAuMilcIlxuICAgIH0pO1xufVxuZnVuY3Rpb24gY2hhbmdlX2xheW91dCgpIHtcbiAgICAkKFwiYm9keVwiKS50b2dnbGVDbGFzcyhcImZpeGVkXCIpO1xuICAgIGZpeF9zaWRlYmFyKCk7XG59XG5mdW5jdGlvbiBjaGFuZ2Vfc2tpbihjbHMpIHtcbiAgICAkKFwiYm9keVwiKS5yZW1vdmVDbGFzcyhcInNraW4tYmx1ZSBza2luLWJsYWNrXCIpO1xuICAgICQoXCJib2R5XCIpLmFkZENsYXNzKGNscyk7XG59XG4vKkVORCBERU1PKi9cbiQod2luZG93KS5sb2FkKGZ1bmN0aW9uKCkge1xuICAgIC8qISBwYWNlIDAuNC4xNyAqL1xuICAgIChmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIGEsIGIsIGMsIGQsIGUsIGYsIGcsIGgsIGksIGosIGssIGwsIG0sIG4sIG8sIHAsIHEsIHIsIHMsIHQsIHUsIHYsIHcsIHgsIHksIHosIEEsIEIsIEMsIEQsIEUsIEYsIEcsIEgsIEksIEosIEssIEwsIE0sIE4sIE8sIFAsIFEsIFIsIFMsIFQsIFUsIFYgPSBbXS5zbGljZSwgVyA9IHt9Lmhhc093blByb3BlcnR5LCBYID0gZnVuY3Rpb24oYSwgYikge1xuICAgICAgICAgICAgZnVuY3Rpb24gYygpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmNvbnN0cnVjdG9yID0gYVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZm9yICh2YXIgZCBpbiBiKVxuICAgICAgICAgICAgICAgIFcuY2FsbChiLCBkKSAmJiAoYVtkXSA9IGJbZF0pO1xuICAgICAgICAgICAgcmV0dXJuIGMucHJvdG90eXBlID0gYi5wcm90b3R5cGUsIGEucHJvdG90eXBlID0gbmV3IGMsIGEuX19zdXBlcl9fID0gYi5wcm90b3R5cGUsIGFcbiAgICAgICAgfSwgWSA9IFtdLmluZGV4T2YgfHwgZnVuY3Rpb24oYSkge1xuICAgICAgICAgICAgZm9yICh2YXIgYiA9IDAsIGMgPSB0aGlzLmxlbmd0aDsgYyA+IGI7IGIrKylcbiAgICAgICAgICAgICAgICBpZiAoYiBpbiB0aGlzICYmIHRoaXNbYl0gPT09IGEpXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBiO1xuICAgICAgICAgICAgcmV0dXJuLTFcbiAgICAgICAgfTtcbiAgICAgICAgZm9yICh0ID0ge2NhdGNodXBUaW1lOjUwMCwgaW5pdGlhbFJhdGU6LjAzLCBtaW5UaW1lOjUwMCwgZ2hvc3RUaW1lOjUwMCwgbWF4UHJvZ3Jlc3NQZXJGcmFtZToxMCwgZWFzZUZhY3RvcjoxLjI1LCBzdGFydE9uUGFnZUxvYWQ6ITAsIHJlc3RhcnRPblB1c2hTdGF0ZTohMCwgcmVzdGFydE9uUmVxdWVzdEFmdGVyOjUwMCwgdGFyZ2V0OlwiYm9keVwiLCBlbGVtZW50czp7Y2hlY2tJbnRlcnZhbDoxMDAsIHNlbGVjdG9yczpbXCJib2R5XCJdfSwgZXZlbnRMYWc6e21pblNhbXBsZXM6MTAsIHNhbXBsZUNvdW50OjMsIGxhZ1RocmVzaG9sZDozfSwgYWpheDp7dHJhY2tNZXRob2RzOltcIkdFVFwiXSwgdHJhY2tXZWJTb2NrZXRzOiExfX0sIEIgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHZhciBhO1xuICAgICAgICAgICAgcmV0dXJuIG51bGwgIT0gKGEgPSBcInVuZGVmaW5lZFwiICE9IHR5cGVvZiBwZXJmb3JtYW5jZSAmJiBudWxsICE9PSBwZXJmb3JtYW5jZSA/IFwiZnVuY3Rpb25cIiA9PSB0eXBlb2YgcGVyZm9ybWFuY2Uubm93ID8gcGVyZm9ybWFuY2Uubm93KCkgOiB2b2lkIDAgOiB2b2lkIDApID8gYSA6ICtuZXcgRGF0ZVxuICAgICAgICB9LCBEID0gd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSB8fCB3aW5kb3cubW96UmVxdWVzdEFuaW1hdGlvbkZyYW1lIHx8IHdpbmRvdy53ZWJraXRSZXF1ZXN0QW5pbWF0aW9uRnJhbWUgfHwgd2luZG93Lm1zUmVxdWVzdEFuaW1hdGlvbkZyYW1lLCBzID0gd2luZG93LmNhbmNlbEFuaW1hdGlvbkZyYW1lIHx8IHdpbmRvdy5tb3pDYW5jZWxBbmltYXRpb25GcmFtZSwgbnVsbCA9PSBEICYmIChEID0gZnVuY3Rpb24oYSkge1xuICAgICAgICAgICAgcmV0dXJuIHNldFRpbWVvdXQoYSwgNTApXG4gICAgICAgIH0sIHMgPSBmdW5jdGlvbihhKSB7XG4gICAgICAgICAgICByZXR1cm4gY2xlYXJUaW1lb3V0KGEpXG4gICAgICAgIH0pLCBGID0gZnVuY3Rpb24oYSkge1xuICAgICAgICAgICAgdmFyIGIsIGM7XG4gICAgICAgICAgICByZXR1cm4gYiA9IEIoKSwgKGMgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICB2YXIgZDtcbiAgICAgICAgICAgICAgICByZXR1cm4gZCA9IEIoKSAtIGIsIGQgPj0gMzMgPyAoYiA9IEIoKSwgYShkLCBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIEQoYylcbiAgICAgICAgICAgICAgICB9KSkgOiBzZXRUaW1lb3V0KGMsIDMzIC0gZClcbiAgICAgICAgICAgIH0pKClcbiAgICAgICAgfSwgRSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgdmFyIGEsIGIsIGM7XG4gICAgICAgICAgICByZXR1cm4gYyA9IGFyZ3VtZW50c1swXSwgYiA9IGFyZ3VtZW50c1sxXSwgYSA9IDMgPD0gYXJndW1lbnRzLmxlbmd0aCA/IFYuY2FsbChhcmd1bWVudHMsIDIpIDogW10sIFwiZnVuY3Rpb25cIiA9PSB0eXBlb2YgY1tiXSA/IGNbYl0uYXBwbHkoYywgYSkgOiBjW2JdXG4gICAgICAgIH0sIHUgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHZhciBhLCBiLCBjLCBkLCBlLCBmLCBnO1xuICAgICAgICAgICAgZm9yIChiID0gYXJndW1lbnRzWzBdLCBkID0gMiA8PSBhcmd1bWVudHMubGVuZ3RoP1YuY2FsbChhcmd1bWVudHMsIDEpOltdLCBmID0gMCwgZyA9IGQubGVuZ3RoOyBnID4gZjsgZisrKVxuICAgICAgICAgICAgICAgIGlmIChjID0gZFtmXSlcbiAgICAgICAgICAgICAgICAgICAgZm9yIChhIGluIGMpXG4gICAgICAgICAgICAgICAgICAgICAgICBXLmNhbGwoYywgYSkgJiYgKGUgPSBjW2FdLCBudWxsICE9IGJbYV0gJiYgXCJvYmplY3RcIiA9PSB0eXBlb2YgYlthXSAmJiBudWxsICE9IGUgJiYgXCJvYmplY3RcIiA9PSB0eXBlb2YgZSA/IHUoYlthXSwgZSkgOiBiW2FdID0gZSk7XG4gICAgICAgICAgICByZXR1cm4gYlxuICAgICAgICB9LCBwID0gZnVuY3Rpb24oYSkge1xuICAgICAgICAgICAgdmFyIGIsIGMsIGQsIGUsIGY7XG4gICAgICAgICAgICBmb3IgKGMgPSBiID0gMCwgZSA9IDAsIGYgPSBhLmxlbmd0aDsgZiA+IGU7IGUrKylcbiAgICAgICAgICAgICAgICBkID0gYVtlXSwgYyArPSBNYXRoLmFicyhkKSwgYisrO1xuICAgICAgICAgICAgcmV0dXJuIGMgLyBiXG4gICAgICAgIH0sIHcgPSBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICB2YXIgYywgZCwgZTtcbiAgICAgICAgICAgIGlmIChudWxsID09IGEgJiYgKGEgPSBcIm9wdGlvbnNcIiksIG51bGwgPT0gYiAmJiAoYiA9ICEwKSwgZSA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoXCJbZGF0YS1wYWNlLVwiICsgYSArIFwiXVwiKSkge1xuICAgICAgICAgICAgICAgIGlmIChjID0gZS5nZXRBdHRyaWJ1dGUoXCJkYXRhLXBhY2UtXCIgKyBhKSwgIWIpXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBjO1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBKU09OLnBhcnNlKGMpXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZikge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZCA9IGYsIFwidW5kZWZpbmVkXCIgIT0gdHlwZW9mIGNvbnNvbGUgJiYgbnVsbCAhPT0gY29uc29sZSA/IGNvbnNvbGUuZXJyb3IoXCJFcnJvciBwYXJzaW5nIGlubGluZSBwYWNlIG9wdGlvbnNcIiwgZCkgOiB2b2lkIDBcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sIGcgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIGZ1bmN0aW9uIGEoKSB7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gYS5wcm90b3R5cGUub24gPSBmdW5jdGlvbihhLCBiLCBjLCBkKSB7XG4gICAgICAgICAgICAgICAgdmFyIGU7XG4gICAgICAgICAgICAgICAgcmV0dXJuIG51bGwgPT0gZCAmJiAoZCA9ICExKSwgbnVsbCA9PSB0aGlzLmJpbmRpbmdzICYmICh0aGlzLmJpbmRpbmdzID0ge30pLCBudWxsID09IChlID0gdGhpcy5iaW5kaW5ncylbYV0gJiYgKGVbYV0gPSBbXSksIHRoaXMuYmluZGluZ3NbYV0ucHVzaCh7aGFuZGxlcjogYiwgY3R4OiBjLCBvbmNlOiBkfSlcbiAgICAgICAgICAgIH0sIGEucHJvdG90eXBlLm9uY2UgPSBmdW5jdGlvbihhLCBiLCBjKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMub24oYSwgYiwgYywgITApXG4gICAgICAgICAgICB9LCBhLnByb3RvdHlwZS5vZmYgPSBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICAgICAgdmFyIGMsIGQsIGU7XG4gICAgICAgICAgICAgICAgaWYgKG51bGwgIT0gKG51bGwgIT0gKGQgPSB0aGlzLmJpbmRpbmdzKSA/IGRbYV0gOiB2b2lkIDApKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChudWxsID09IGIpXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gZGVsZXRlIHRoaXMuYmluZGluZ3NbYV07XG4gICAgICAgICAgICAgICAgICAgIGZvciAoYyA9IDAsIGUgPSBbXTsgYyA8IHRoaXMuYmluZGluZ3NbYV0ubGVuZ3RoOyApXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmJpbmRpbmdzW2FdW2NdLmhhbmRsZXIgPT09IGIgPyBlLnB1c2godGhpcy5iaW5kaW5nc1thXS5zcGxpY2UoYywgMSkpIDogZS5wdXNoKGMrKyk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBlXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSwgYS5wcm90b3R5cGUudHJpZ2dlciA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgIHZhciBhLCBiLCBjLCBkLCBlLCBmLCBnLCBoLCBpO1xuICAgICAgICAgICAgICAgIGlmIChjID0gYXJndW1lbnRzWzBdLCBhID0gMiA8PSBhcmd1bWVudHMubGVuZ3RoID8gVi5jYWxsKGFyZ3VtZW50cywgMSkgOiBbXSwgbnVsbCAhPSAoZyA9IHRoaXMuYmluZGluZ3MpID8gZ1tjXSA6IHZvaWQgMCkge1xuICAgICAgICAgICAgICAgICAgICBmb3IgKGUgPSAwLCBpID0gW107IGUgPCB0aGlzLmJpbmRpbmdzW2NdLmxlbmd0aDsgKVxuICAgICAgICAgICAgICAgICAgICAgICAgaCA9IHRoaXMuYmluZGluZ3NbY11bZV0sIGQgPSBoLmhhbmRsZXIsIGIgPSBoLmN0eCwgZiA9IGgub25jZSwgZC5hcHBseShudWxsICE9IGIgPyBiIDogdGhpcywgYSksIGYgPyBpLnB1c2godGhpcy5iaW5kaW5nc1tjXS5zcGxpY2UoZSwgMSkpIDogaS5wdXNoKGUrKyk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSwgYVxuICAgICAgICB9KCksIG51bGwgPT0gd2luZG93LlBhY2UgJiYgKHdpbmRvdy5QYWNlID0ge30pLCB1KFBhY2UsIGcucHJvdG90eXBlKSwgQyA9IFBhY2Uub3B0aW9ucyA9IHUoe30sIHQsIHdpbmRvdy5wYWNlT3B0aW9ucywgdygpKSwgUyA9IFtcImFqYXhcIiwgXCJkb2N1bWVudFwiLCBcImV2ZW50TGFnXCIsIFwiZWxlbWVudHNcIl0sIE8gPSAwLCBRID0gUy5sZW5ndGg7IFEgPiBPOyBPKyspXG4gICAgICAgICAgICBJID0gU1tPXSwgQ1tJXSA9PT0gITAgJiYgKENbSV0gPSB0W0ldKTtcbiAgICAgICAgaSA9IGZ1bmN0aW9uKGEpIHtcbiAgICAgICAgICAgIGZ1bmN0aW9uIGIoKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIFQgPSBiLl9fc3VwZXJfXy5jb25zdHJ1Y3Rvci5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gWChiLCBhKSwgYlxuICAgICAgICB9KEVycm9yKSwgYiA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgZnVuY3Rpb24gYSgpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnByb2dyZXNzID0gMFxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGEucHJvdG90eXBlLmdldEVsZW1lbnQgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICB2YXIgYTtcbiAgICAgICAgICAgICAgICBpZiAobnVsbCA9PSB0aGlzLmVsKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChhID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcihDLnRhcmdldCksICFhKVxuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IGk7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpLCB0aGlzLmVsLmNsYXNzTmFtZSA9IFwicGFjZSBwYWNlLWFjdGl2ZVwiLCBkb2N1bWVudC5ib2R5LmNsYXNzTmFtZSA9IGRvY3VtZW50LmJvZHkuY2xhc3NOYW1lLnJlcGxhY2UoXCJwYWNlLWRvbmVcIiwgXCJcIiksIGRvY3VtZW50LmJvZHkuY2xhc3NOYW1lICs9IFwiIHBhY2UtcnVubmluZ1wiLCB0aGlzLmVsLmlubmVySFRNTCA9ICc8ZGl2IGNsYXNzPVwicGFjZS1wcm9ncmVzc1wiPlxcbiAgPGRpdiBjbGFzcz1cInBhY2UtcHJvZ3Jlc3MtaW5uZXJcIj48L2Rpdj5cXG48L2Rpdj5cXG48ZGl2IGNsYXNzPVwicGFjZS1hY3Rpdml0eVwiPjwvZGl2PicsIG51bGwgIT0gYS5maXJzdENoaWxkID8gYS5pbnNlcnRCZWZvcmUodGhpcy5lbCwgYS5maXJzdENoaWxkKSA6IGEuYXBwZW5kQ2hpbGQodGhpcy5lbClcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuZWxcbiAgICAgICAgICAgIH0sIGEucHJvdG90eXBlLmZpbmlzaCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgIHZhciBhO1xuICAgICAgICAgICAgICAgIHJldHVybiBhID0gdGhpcy5nZXRFbGVtZW50KCksIGEuY2xhc3NOYW1lID0gYS5jbGFzc05hbWUucmVwbGFjZShcInBhY2UtYWN0aXZlXCIsIFwiXCIpLCBhLmNsYXNzTmFtZSArPSBcIiBwYWNlLWluYWN0aXZlXCIsIGRvY3VtZW50LmJvZHkuY2xhc3NOYW1lID0gZG9jdW1lbnQuYm9keS5jbGFzc05hbWUucmVwbGFjZShcInBhY2UtcnVubmluZ1wiLCBcIlwiKSwgZG9jdW1lbnQuYm9keS5jbGFzc05hbWUgKz0gXCIgcGFjZS1kb25lXCJcbiAgICAgICAgICAgIH0sIGEucHJvdG90eXBlLnVwZGF0ZSA9IGZ1bmN0aW9uKGEpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5wcm9ncmVzcyA9IGEsIHRoaXMucmVuZGVyKClcbiAgICAgICAgICAgIH0sIGEucHJvdG90eXBlLmRlc3Ryb3kgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmdldEVsZW1lbnQoKS5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKHRoaXMuZ2V0RWxlbWVudCgpKVxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGEpIHtcbiAgICAgICAgICAgICAgICAgICAgaSA9IGFcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuZWwgPSB2b2lkIDBcbiAgICAgICAgICAgIH0sIGEucHJvdG90eXBlLnJlbmRlciA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgIHZhciBhLCBiO1xuICAgICAgICAgICAgICAgIHJldHVybiBudWxsID09IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoQy50YXJnZXQpID8gITEgOiAoYSA9IHRoaXMuZ2V0RWxlbWVudCgpLCBhLmNoaWxkcmVuWzBdLnN0eWxlLndpZHRoID0gXCJcIiArIHRoaXMucHJvZ3Jlc3MgKyBcIiVcIiwgKCF0aGlzLmxhc3RSZW5kZXJlZFByb2dyZXNzIHx8IHRoaXMubGFzdFJlbmRlcmVkUHJvZ3Jlc3MgfCAwICE9PSB0aGlzLnByb2dyZXNzIHwgMCkgJiYgKGEuY2hpbGRyZW5bMF0uc2V0QXR0cmlidXRlKFwiZGF0YS1wcm9ncmVzcy10ZXh0XCIsIFwiXCIgKyAoMCB8IHRoaXMucHJvZ3Jlc3MpICsgXCIlXCIpLCB0aGlzLnByb2dyZXNzID49IDEwMCA/IGIgPSBcIjk5XCIgOiAoYiA9IHRoaXMucHJvZ3Jlc3MgPCAxMCA/IFwiMFwiIDogXCJcIiwgYiArPSAwIHwgdGhpcy5wcm9ncmVzcyksIGEuY2hpbGRyZW5bMF0uc2V0QXR0cmlidXRlKFwiZGF0YS1wcm9ncmVzc1wiLCBcIlwiICsgYikpLCB0aGlzLmxhc3RSZW5kZXJlZFByb2dyZXNzID0gdGhpcy5wcm9ncmVzcylcbiAgICAgICAgICAgIH0sIGEucHJvdG90eXBlLmRvbmUgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5wcm9ncmVzcyA+PSAxMDBcbiAgICAgICAgICAgIH0sIGFcbiAgICAgICAgfSgpLCBoID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICBmdW5jdGlvbiBhKCkge1xuICAgICAgICAgICAgICAgIHRoaXMuYmluZGluZ3MgPSB7fVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGEucHJvdG90eXBlLnRyaWdnZXIgPSBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICAgICAgdmFyIGMsIGQsIGUsIGYsIGc7XG4gICAgICAgICAgICAgICAgaWYgKG51bGwgIT0gdGhpcy5iaW5kaW5nc1thXSkge1xuICAgICAgICAgICAgICAgICAgICBmb3IgKGYgPSB0aGlzLmJpbmRpbmdzW2FdLCBnID0gW10sIGQgPSAwLCBlID0gZi5sZW5ndGg7IGUgPiBkOyBkKyspXG4gICAgICAgICAgICAgICAgICAgICAgICBjID0gZltkXSwgZy5wdXNoKGMuY2FsbCh0aGlzLCBiKSk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBnXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSwgYS5wcm90b3R5cGUub24gPSBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICAgICAgdmFyIGM7XG4gICAgICAgICAgICAgICAgcmV0dXJuIG51bGwgPT0gKGMgPSB0aGlzLmJpbmRpbmdzKVthXSAmJiAoY1thXSA9IFtdKSwgdGhpcy5iaW5kaW5nc1thXS5wdXNoKGIpXG4gICAgICAgICAgICB9LCBhXG4gICAgICAgIH0oKSwgTiA9IHdpbmRvdy5YTUxIdHRwUmVxdWVzdCwgTSA9IHdpbmRvdy5YRG9tYWluUmVxdWVzdCwgTCA9IHdpbmRvdy5XZWJTb2NrZXQsIHYgPSBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICB2YXIgYywgZCwgZSwgZjtcbiAgICAgICAgICAgIGYgPSBbXTtcbiAgICAgICAgICAgIGZvciAoZCBpbiBiLnByb3RvdHlwZSlcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBlID0gYi5wcm90b3R5cGVbZF0sIG51bGwgPT0gYVtkXSAmJiBcImZ1bmN0aW9uXCIgIT0gdHlwZW9mIGUgPyBmLnB1c2goYVtkXSA9IGUpIDogZi5wdXNoKHZvaWQgMClcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChnKSB7XG4gICAgICAgICAgICAgICAgICAgIGMgPSBnXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGZcbiAgICAgICAgfSwgeiA9IFtdLCBQYWNlLmlnbm9yZSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgdmFyIGEsIGIsIGM7XG4gICAgICAgICAgICByZXR1cm4gYiA9IGFyZ3VtZW50c1swXSwgYSA9IDIgPD0gYXJndW1lbnRzLmxlbmd0aCA/IFYuY2FsbChhcmd1bWVudHMsIDEpIDogW10sIHoudW5zaGlmdChcImlnbm9yZVwiKSwgYyA9IGIuYXBwbHkobnVsbCwgYSksIHouc2hpZnQoKSwgY1xuICAgICAgICB9LCBQYWNlLnRyYWNrID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICB2YXIgYSwgYiwgYztcbiAgICAgICAgICAgIHJldHVybiBiID0gYXJndW1lbnRzWzBdLCBhID0gMiA8PSBhcmd1bWVudHMubGVuZ3RoID8gVi5jYWxsKGFyZ3VtZW50cywgMSkgOiBbXSwgei51bnNoaWZ0KFwidHJhY2tcIiksIGMgPSBiLmFwcGx5KG51bGwsIGEpLCB6LnNoaWZ0KCksIGNcbiAgICAgICAgfSwgSCA9IGZ1bmN0aW9uKGEpIHtcbiAgICAgICAgICAgIHZhciBiO1xuICAgICAgICAgICAgaWYgKG51bGwgPT0gYSAmJiAoYSA9IFwiR0VUXCIpLCBcInRyYWNrXCIgPT09IHpbMF0pXG4gICAgICAgICAgICAgICAgcmV0dXJuXCJmb3JjZVwiO1xuICAgICAgICAgICAgaWYgKCF6Lmxlbmd0aCAmJiBDLmFqYXgpIHtcbiAgICAgICAgICAgICAgICBpZiAoXCJzb2NrZXRcIiA9PT0gYSAmJiBDLmFqYXgudHJhY2tXZWJTb2NrZXRzKVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4hMDtcbiAgICAgICAgICAgICAgICBpZiAoYiA9IGEudG9VcHBlckNhc2UoKSwgWS5jYWxsKEMuYWpheC50cmFja01ldGhvZHMsIGIpID49IDApXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiEwXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4hMVxuICAgICAgICB9LCBqID0gZnVuY3Rpb24oYSkge1xuICAgICAgICAgICAgZnVuY3Rpb24gYigpIHtcbiAgICAgICAgICAgICAgICB2YXIgYSwgYyA9IHRoaXM7XG4gICAgICAgICAgICAgICAgYi5fX3N1cGVyX18uY29uc3RydWN0b3IuYXBwbHkodGhpcywgYXJndW1lbnRzKSwgYSA9IGZ1bmN0aW9uKGEpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGI7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBiID0gYS5vcGVuLCBhLm9wZW4gPSBmdW5jdGlvbihkLCBlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gSChkKSAmJiBjLnRyaWdnZXIoXCJyZXF1ZXN0XCIsIHt0eXBlOiBkLCB1cmw6IGUsIHJlcXVlc3Q6IGF9KSwgYi5hcHBseShhLCBhcmd1bWVudHMpXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LCB3aW5kb3cuWE1MSHR0cFJlcXVlc3QgPSBmdW5jdGlvbihiKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBjO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gYyA9IG5ldyBOKGIpLCBhKGMpLCBjXG4gICAgICAgICAgICAgICAgfSwgdih3aW5kb3cuWE1MSHR0cFJlcXVlc3QsIE4pLCBudWxsICE9IE0gJiYgKHdpbmRvdy5YRG9tYWluUmVxdWVzdCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgICAgICB2YXIgYjtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGIgPSBuZXcgTSwgYShiKSwgYlxuICAgICAgICAgICAgICAgIH0sIHYod2luZG93LlhEb21haW5SZXF1ZXN0LCBNKSksIG51bGwgIT0gTCAmJiBDLmFqYXgudHJhY2tXZWJTb2NrZXRzICYmICh3aW5kb3cuV2ViU29ja2V0ID0gZnVuY3Rpb24oYSwgYikge1xuICAgICAgICAgICAgICAgICAgICB2YXIgZDtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGQgPSBuZXcgTChhLCBiKSwgSChcInNvY2tldFwiKSAmJiBjLnRyaWdnZXIoXCJyZXF1ZXN0XCIsIHt0eXBlOiBcInNvY2tldFwiLCB1cmw6IGEsIHByb3RvY29sczogYiwgcmVxdWVzdDogZH0pLCBkXG4gICAgICAgICAgICAgICAgfSwgdih3aW5kb3cuV2ViU29ja2V0LCBMKSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBYKGIsIGEpLCBiXG4gICAgICAgIH0oaCksIFAgPSBudWxsLCB4ID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICByZXR1cm4gbnVsbCA9PSBQICYmIChQID0gbmV3IGopLCBQXG4gICAgICAgIH0sIHgoKS5vbihcInJlcXVlc3RcIiwgZnVuY3Rpb24oYikge1xuICAgICAgICAgICAgdmFyIGMsIGQsIGUsIGY7XG4gICAgICAgICAgICByZXR1cm4gZiA9IGIudHlwZSwgZSA9IGIucmVxdWVzdCwgUGFjZS5ydW5uaW5nIHx8IEMucmVzdGFydE9uUmVxdWVzdEFmdGVyID09PSAhMSAmJiBcImZvcmNlXCIgIT09IEgoZikgPyB2b2lkIDAgOiAoZCA9IGFyZ3VtZW50cywgYyA9IEMucmVzdGFydE9uUmVxdWVzdEFmdGVyIHx8IDAsIFwiYm9vbGVhblwiID09IHR5cGVvZiBjICYmIChjID0gMCksIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgdmFyIGIsIGMsIGcsIGgsIGksIGo7XG4gICAgICAgICAgICAgICAgaWYgKGIgPSBcInNvY2tldFwiID09PSBmID8gZS5yZWFkeVN0YXRlIDwgMiA6IDAgPCAoaCA9IGUucmVhZHlTdGF0ZSkgJiYgNCA+IGgpIHtcbiAgICAgICAgICAgICAgICAgICAgZm9yIChQYWNlLnJlc3RhcnQoKSwgaSA9IFBhY2Uuc291cmNlcywgaiA9IFtdLCBjID0gMCwgZyA9IGkubGVuZ3RoOyBnID4gYzsgYysrKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoSSA9IGlbY10sIEkgaW5zdGFuY2VvZiBhKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgSS53YXRjaC5hcHBseShJLCBkKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVha1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgai5wdXNoKHZvaWQgMClcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4galxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sIGMpKVxuICAgICAgICB9KSwgYSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgZnVuY3Rpb24gYSgpIHtcbiAgICAgICAgICAgICAgICB2YXIgYSA9IHRoaXM7XG4gICAgICAgICAgICAgICAgdGhpcy5lbGVtZW50cyA9IFtdLCB4KCkub24oXCJyZXF1ZXN0XCIsIGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gYS53YXRjaC5hcHBseShhLCBhcmd1bWVudHMpXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBhLnByb3RvdHlwZS53YXRjaCA9IGZ1bmN0aW9uKGEpIHtcbiAgICAgICAgICAgICAgICB2YXIgYiwgYywgZDtcbiAgICAgICAgICAgICAgICByZXR1cm4gZCA9IGEudHlwZSwgYiA9IGEucmVxdWVzdCwgYyA9IFwic29ja2V0XCIgPT09IGQgPyBuZXcgbShiKSA6IG5ldyBuKGIpLCB0aGlzLmVsZW1lbnRzLnB1c2goYylcbiAgICAgICAgICAgIH0sIGFcbiAgICAgICAgfSgpLCBuID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICBmdW5jdGlvbiBhKGEpIHtcbiAgICAgICAgICAgICAgICB2YXIgYiwgYywgZCwgZSwgZiwgZywgaCA9IHRoaXM7XG4gICAgICAgICAgICAgICAgaWYgKHRoaXMucHJvZ3Jlc3MgPSAwLCBudWxsICE9IHdpbmRvdy5Qcm9ncmVzc0V2ZW50KVxuICAgICAgICAgICAgICAgICAgICBmb3IgKGMgPSBudWxsLCBhLmFkZEV2ZW50TGlzdGVuZXIoXCJwcm9ncmVzc1wiLCBmdW5jdGlvbihhKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gaC5wcm9ncmVzcyA9IGEubGVuZ3RoQ29tcHV0YWJsZSA/IDEwMCAqIGEubG9hZGVkIC8gYS50b3RhbCA6IGgucHJvZ3Jlc3MgKyAoMTAwIC0gaC5wcm9ncmVzcykgLyAyXG4gICAgICAgICAgICAgICAgICAgIH0pLCBnID0gW1wibG9hZFwiLCBcImFib3J0XCIsIFwidGltZW91dFwiLCBcImVycm9yXCJdLCBkID0gMCwgZSA9IGcubGVuZ3RoOyBlID4gZDsgZCsrKVxuICAgICAgICAgICAgICAgICAgICAgICAgYiA9IGdbZF0sIGEuYWRkRXZlbnRMaXN0ZW5lcihiLCBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gaC5wcm9ncmVzcyA9IDEwMFxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgZWxzZVxuICAgICAgICAgICAgICAgICAgICBmID0gYS5vbnJlYWR5c3RhdGVjaGFuZ2UsIGEub25yZWFkeXN0YXRlY2hhbmdlID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YXIgYjtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAwID09PSAoYiA9IGEucmVhZHlTdGF0ZSkgfHwgNCA9PT0gYiA/IGgucHJvZ3Jlc3MgPSAxMDAgOiAzID09PSBhLnJlYWR5U3RhdGUgJiYgKGgucHJvZ3Jlc3MgPSA1MCksIFwiZnVuY3Rpb25cIiA9PSB0eXBlb2YgZiA/IGYuYXBwbHkobnVsbCwgYXJndW1lbnRzKSA6IHZvaWQgMFxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gYVxuICAgICAgICB9KCksIG0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIGZ1bmN0aW9uIGEoYSkge1xuICAgICAgICAgICAgICAgIHZhciBiLCBjLCBkLCBlLCBmID0gdGhpcztcbiAgICAgICAgICAgICAgICBmb3IgKHRoaXMucHJvZ3Jlc3MgPSAwLCBlID0gW1wiZXJyb3JcIiwgXCJvcGVuXCJdLCBjID0gMCwgZCA9IGUubGVuZ3RoOyBkID4gYzsgYysrKVxuICAgICAgICAgICAgICAgICAgICBiID0gZVtjXSwgYS5hZGRFdmVudExpc3RlbmVyKGIsIGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGYucHJvZ3Jlc3MgPSAxMDBcbiAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBhXG4gICAgICAgIH0oKSwgZCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgZnVuY3Rpb24gYShhKSB7XG4gICAgICAgICAgICAgICAgdmFyIGIsIGMsIGQsIGY7XG4gICAgICAgICAgICAgICAgZm9yIChudWxsID09IGEgJiYgKGEgPSB7fSksIHRoaXMuZWxlbWVudHMgPSBbXSwgbnVsbCA9PSBhLnNlbGVjdG9ycyAmJiAoYS5zZWxlY3RvcnMgPSBbXSksIGYgPSBhLnNlbGVjdG9ycywgYyA9IDAsIGQgPSBmLmxlbmd0aDsgZCA+IGM7IGMrKylcbiAgICAgICAgICAgICAgICAgICAgYiA9IGZbY10sIHRoaXMuZWxlbWVudHMucHVzaChuZXcgZShiKSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBhXG4gICAgICAgIH0oKSwgZSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgZnVuY3Rpb24gYShhKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5zZWxlY3RvciA9IGEsIHRoaXMucHJvZ3Jlc3MgPSAwLCB0aGlzLmNoZWNrKClcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBhLnByb3RvdHlwZS5jaGVjayA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgIHZhciBhID0gdGhpcztcbiAgICAgICAgICAgICAgICByZXR1cm4gZG9jdW1lbnQucXVlcnlTZWxlY3Rvcih0aGlzLnNlbGVjdG9yKSA/IHRoaXMuZG9uZSgpIDogc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGEuY2hlY2soKVxuICAgICAgICAgICAgICAgIH0sIEMuZWxlbWVudHMuY2hlY2tJbnRlcnZhbClcbiAgICAgICAgICAgIH0sIGEucHJvdG90eXBlLmRvbmUgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5wcm9ncmVzcyA9IDEwMFxuICAgICAgICAgICAgfSwgYVxuICAgICAgICB9KCksIGMgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIGZ1bmN0aW9uIGEoKSB7XG4gICAgICAgICAgICAgICAgdmFyIGEsIGIsIGMgPSB0aGlzO1xuICAgICAgICAgICAgICAgIHRoaXMucHJvZ3Jlc3MgPSBudWxsICE9IChiID0gdGhpcy5zdGF0ZXNbZG9jdW1lbnQucmVhZHlTdGF0ZV0pID8gYiA6IDEwMCwgYSA9IGRvY3VtZW50Lm9ucmVhZHlzdGF0ZWNoYW5nZSwgZG9jdW1lbnQub25yZWFkeXN0YXRlY2hhbmdlID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBudWxsICE9IGMuc3RhdGVzW2RvY3VtZW50LnJlYWR5U3RhdGVdICYmIChjLnByb2dyZXNzID0gYy5zdGF0ZXNbZG9jdW1lbnQucmVhZHlTdGF0ZV0pLCBcImZ1bmN0aW9uXCIgPT0gdHlwZW9mIGEgPyBhLmFwcGx5KG51bGwsIGFyZ3VtZW50cykgOiB2b2lkIDBcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gYS5wcm90b3R5cGUuc3RhdGVzID0ge2xvYWRpbmc6IDAsIGludGVyYWN0aXZlOiA1MCwgY29tcGxldGU6IDEwMH0sIGFcbiAgICAgICAgfSgpLCBmID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICBmdW5jdGlvbiBhKCkge1xuICAgICAgICAgICAgICAgIHZhciBhLCBiLCBjLCBkLCBlLCBmID0gdGhpcztcbiAgICAgICAgICAgICAgICB0aGlzLnByb2dyZXNzID0gMCwgYSA9IDAsIGUgPSBbXSwgZCA9IDAsIGMgPSBCKCksIGIgPSBzZXRJbnRlcnZhbChmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGc7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBnID0gQigpIC0gYyAtIDUwLCBjID0gQigpLCBlLnB1c2goZyksIGUubGVuZ3RoID4gQy5ldmVudExhZy5zYW1wbGVDb3VudCAmJiBlLnNoaWZ0KCksIGEgPSBwKGUpLCArK2QgPj0gQy5ldmVudExhZy5taW5TYW1wbGVzICYmIGEgPCBDLmV2ZW50TGFnLmxhZ1RocmVzaG9sZCA/IChmLnByb2dyZXNzID0gMTAwLCBjbGVhckludGVydmFsKGIpKSA6IGYucHJvZ3Jlc3MgPSAxMDAgKiAoMyAvIChhICsgMykpXG4gICAgICAgICAgICAgICAgfSwgNTApXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gYVxuICAgICAgICB9KCksIGwgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIGZ1bmN0aW9uIGEoYSkge1xuICAgICAgICAgICAgICAgIHRoaXMuc291cmNlID0gYSwgdGhpcy5sYXN0ID0gdGhpcy5zaW5jZUxhc3RVcGRhdGUgPSAwLCB0aGlzLnJhdGUgPSBDLmluaXRpYWxSYXRlLCB0aGlzLmNhdGNodXAgPSAwLCB0aGlzLnByb2dyZXNzID0gdGhpcy5sYXN0UHJvZ3Jlc3MgPSAwLCBudWxsICE9IHRoaXMuc291cmNlICYmICh0aGlzLnByb2dyZXNzID0gRSh0aGlzLnNvdXJjZSwgXCJwcm9ncmVzc1wiKSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBhLnByb3RvdHlwZS50aWNrID0gZnVuY3Rpb24oYSwgYikge1xuICAgICAgICAgICAgICAgIHZhciBjO1xuICAgICAgICAgICAgICAgIHJldHVybiBudWxsID09IGIgJiYgKGIgPSBFKHRoaXMuc291cmNlLCBcInByb2dyZXNzXCIpKSwgYiA+PSAxMDAgJiYgKHRoaXMuZG9uZSA9ICEwKSwgYiA9PT0gdGhpcy5sYXN0ID8gdGhpcy5zaW5jZUxhc3RVcGRhdGUgKz0gYSA6ICh0aGlzLnNpbmNlTGFzdFVwZGF0ZSAmJiAodGhpcy5yYXRlID0gKGIgLSB0aGlzLmxhc3QpIC8gdGhpcy5zaW5jZUxhc3RVcGRhdGUpLCB0aGlzLmNhdGNodXAgPSAoYiAtIHRoaXMucHJvZ3Jlc3MpIC8gQy5jYXRjaHVwVGltZSwgdGhpcy5zaW5jZUxhc3RVcGRhdGUgPSAwLCB0aGlzLmxhc3QgPSBiKSwgYiA+IHRoaXMucHJvZ3Jlc3MgJiYgKHRoaXMucHJvZ3Jlc3MgKz0gdGhpcy5jYXRjaHVwICogYSksIGMgPSAxIC0gTWF0aC5wb3codGhpcy5wcm9ncmVzcyAvIDEwMCwgQy5lYXNlRmFjdG9yKSwgdGhpcy5wcm9ncmVzcyArPSBjICogdGhpcy5yYXRlICogYSwgdGhpcy5wcm9ncmVzcyA9IE1hdGgubWluKHRoaXMubGFzdFByb2dyZXNzICsgQy5tYXhQcm9ncmVzc1BlckZyYW1lLCB0aGlzLnByb2dyZXNzKSwgdGhpcy5wcm9ncmVzcyA9IE1hdGgubWF4KDAsIHRoaXMucHJvZ3Jlc3MpLCB0aGlzLnByb2dyZXNzID0gTWF0aC5taW4oMTAwLCB0aGlzLnByb2dyZXNzKSwgdGhpcy5sYXN0UHJvZ3Jlc3MgPSB0aGlzLnByb2dyZXNzLCB0aGlzLnByb2dyZXNzXG4gICAgICAgICAgICB9LCBhXG4gICAgICAgIH0oKSwgSiA9IG51bGwsIEcgPSBudWxsLCBxID0gbnVsbCwgSyA9IG51bGwsIG8gPSBudWxsLCByID0gbnVsbCwgUGFjZS5ydW5uaW5nID0gITEsIHkgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJldHVybiBDLnJlc3RhcnRPblB1c2hTdGF0ZSA/IFBhY2UucmVzdGFydCgpIDogdm9pZCAwXG4gICAgICAgIH0sIG51bGwgIT0gd2luZG93Lmhpc3RvcnkucHVzaFN0YXRlICYmIChSID0gd2luZG93Lmhpc3RvcnkucHVzaFN0YXRlLCB3aW5kb3cuaGlzdG9yeS5wdXNoU3RhdGUgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJldHVybiB5KCksIFIuYXBwbHkod2luZG93Lmhpc3RvcnksIGFyZ3VtZW50cylcbiAgICAgICAgfSksIG51bGwgIT0gd2luZG93Lmhpc3RvcnkucmVwbGFjZVN0YXRlICYmIChVID0gd2luZG93Lmhpc3RvcnkucmVwbGFjZVN0YXRlLCB3aW5kb3cuaGlzdG9yeS5yZXBsYWNlU3RhdGUgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJldHVybiB5KCksIFUuYXBwbHkod2luZG93Lmhpc3RvcnksIGFyZ3VtZW50cylcbiAgICAgICAgfSksIGsgPSB7YWpheDogYSwgZWxlbWVudHM6IGQsIGRvY3VtZW50OiBjLCBldmVudExhZzogZn0sIChBID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICB2YXIgYSwgYywgZCwgZSwgZiwgZywgaCwgaTtcbiAgICAgICAgICAgIGZvciAoUGFjZS5zb3VyY2VzID0gSiA9IFtdLCBnID0gW1wiYWpheFwiLCBcImVsZW1lbnRzXCIsIFwiZG9jdW1lbnRcIiwgXCJldmVudExhZ1wiXSwgYyA9IDAsIGUgPSBnLmxlbmd0aDsgZSA+IGM7IGMrKylcbiAgICAgICAgICAgICAgICBhID0gZ1tjXSwgQ1thXSAhPT0gITEgJiYgSi5wdXNoKG5ldyBrW2FdKENbYV0pKTtcbiAgICAgICAgICAgIGZvciAoaSA9IG51bGwgIT0gKGggPSBDLmV4dHJhU291cmNlcyk/aDpbXSwgZCA9IDAsIGYgPSBpLmxlbmd0aDsgZiA+IGQ7IGQrKylcbiAgICAgICAgICAgICAgICBJID0gaVtkXSwgSi5wdXNoKG5ldyBJKEMpKTtcbiAgICAgICAgICAgIHJldHVybiBQYWNlLmJhciA9IHEgPSBuZXcgYiwgRyA9IFtdLCBLID0gbmV3IGxcbiAgICAgICAgfSkoKSwgUGFjZS5zdG9wID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICByZXR1cm4gUGFjZS50cmlnZ2VyKFwic3RvcFwiKSwgUGFjZS5ydW5uaW5nID0gITEsIHEuZGVzdHJveSgpLCByID0gITAsIG51bGwgIT0gbyAmJiAoXCJmdW5jdGlvblwiID09IHR5cGVvZiBzICYmIHMobyksIG8gPSBudWxsKSwgQSgpXG4gICAgICAgIH0sIFBhY2UucmVzdGFydCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmV0dXJuIFBhY2UudHJpZ2dlcihcInJlc3RhcnRcIiksIFBhY2Uuc3RvcCgpLCBQYWNlLnN0YXJ0KClcbiAgICAgICAgfSwgUGFjZS5nbyA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmV0dXJuIFBhY2UucnVubmluZyA9ICEwLCBxLnJlbmRlcigpLCByID0gITEsIG8gPSBGKGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICB2YXIgYywgZCwgZSwgZiwgZywgaCwgaSwgaiwgaywgbSwgbiwgbywgcCwgcywgdCwgdSwgdjtcbiAgICAgICAgICAgICAgICBmb3IgKGogPSAxMDAgLSBxLnByb2dyZXNzLCBkID0gbyA9IDAsIGUgPSAhMCwgaCA9IHAgPSAwLCB0ID0gSi5sZW5ndGg7IHQgPiBwOyBoID0gKytwKVxuICAgICAgICAgICAgICAgICAgICBmb3IgKEkgPSBKW2hdLCBtID0gbnVsbCAhPSBHW2hdP0dbaF06R1toXSA9IFtdLCBnID0gbnVsbCAhPSAodiA9IEkuZWxlbWVudHMpP3Y6W0ldLCBpID0gcyA9IDAsIHUgPSBnLmxlbmd0aDsgdSA+IHM7IGkgPSArK3MpXG4gICAgICAgICAgICAgICAgICAgICAgICBmID0gZ1tpXSwgayA9IG51bGwgIT0gbVtpXSA/IG1baV0gOiBtW2ldID0gbmV3IGwoZiksIGUgJj0gay5kb25lLCBrLmRvbmUgfHwgKGQrKywgbyArPSBrLnRpY2soYSkpO1xuICAgICAgICAgICAgICAgIHJldHVybiBjID0gbyAvIGQsIHEudXBkYXRlKEsudGljayhhLCBjKSksIG4gPSBCKCksIHEuZG9uZSgpIHx8IGUgfHwgciA/IChxLnVwZGF0ZSgxMDApLCBQYWNlLnRyaWdnZXIoXCJkb25lXCIpLCBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gcS5maW5pc2goKSwgUGFjZS5ydW5uaW5nID0gITEsIFBhY2UudHJpZ2dlcihcImhpZGVcIilcbiAgICAgICAgICAgICAgICB9LCBNYXRoLm1heChDLmdob3N0VGltZSwgTWF0aC5taW4oQy5taW5UaW1lLCBCKCkgLSBuKSkpKSA6IGIoKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfSwgUGFjZS5zdGFydCA9IGZ1bmN0aW9uKGEpIHtcbiAgICAgICAgICAgIHUoQywgYSksIFBhY2UucnVubmluZyA9ICEwO1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBxLnJlbmRlcigpXG4gICAgICAgICAgICB9IGNhdGNoIChiKSB7XG4gICAgICAgICAgICAgICAgaSA9IGJcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKFwiLnBhY2VcIikgPyAoUGFjZS50cmlnZ2VyKFwic3RhcnRcIiksIFBhY2UuZ28oKSkgOiBzZXRUaW1lb3V0KFBhY2Uuc3RhcnQsIDUwKVxuICAgICAgICB9LCBcImZ1bmN0aW9uXCIgPT0gdHlwZW9mIGRlZmluZSAmJiBkZWZpbmUuYW1kID8gZGVmaW5lKCd0aGVtZS1hcHAnLCBbXSwgZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICByZXR1cm4gUGFjZVxuICAgICAgICB9KSA6IFwib2JqZWN0XCIgPT0gdHlwZW9mIGV4cG9ydHMgPyBtb2R1bGUuZXhwb3J0cyA9IFBhY2UgOiBDLnN0YXJ0T25QYWdlTG9hZCAmJiBQYWNlLnN0YXJ0KClcbiAgICB9KS5jYWxsKHRoaXMpO1xufSk7XG5cbi8qIFxuICogQk9YIFJFRlJFU0ggQlVUVE9OIFxuICogLS0tLS0tLS0tLS0tLS0tLS0tXG4gKiBUaGlzIGlzIGEgY3VzdG9tIHBsdWdpbiB0byB1c2Ugd2l0aCB0aGUgY29tcGVuZXQgQk9YLiBJdCBhbGxvd3MgeW91IHRvIGFkZFxuICogYSByZWZyZXNoIGJ1dHRvbiB0byB0aGUgYm94LiBJdCBjb252ZXJ0cyB0aGUgYm94J3Mgc3RhdGUgdG8gYSBsb2FkaW5nIHN0YXRlLlxuICogXG4gKiBVU0FHRTpcbiAqICAkKFwiI2JveC13aWRnZXRcIikuYm94UmVmcmVzaCggb3B0aW9ucyApO1xuICogKi9cbihmdW5jdGlvbigkKSB7XG4gICAgXCJ1c2Ugc3RyaWN0XCI7XG5cbiAgICAkLmZuLmJveFJlZnJlc2ggPSBmdW5jdGlvbihvcHRpb25zKSB7XG5cbiAgICAgICAgLy8gUmVuZGVyIG9wdGlvbnNcbiAgICAgICAgdmFyIHNldHRpbmdzID0gJC5leHRlbmQoe1xuICAgICAgICAgICAgLy9SZWZyZXNzaCBidXR0b24gc2VsZWN0b3JcbiAgICAgICAgICAgIHRyaWdnZXI6IFwiLnJlZnJlc2gtYnRuXCIsXG4gICAgICAgICAgICAvL0ZpbGUgc291cmNlIHRvIGJlIGxvYWRlZCAoZS5nOiBhamF4L3NyYy5waHApXG4gICAgICAgICAgICBzb3VyY2U6IFwiXCIsXG4gICAgICAgICAgICAvL0NhbGxiYWNrc1xuICAgICAgICAgICAgb25Mb2FkU3RhcnQ6IGZ1bmN0aW9uKGJveCkge1xuICAgICAgICAgICAgfSwgLy9SaWdodCBhZnRlciB0aGUgYnV0dG9uIGhhcyBiZWVuIGNsaWNrZWRcbiAgICAgICAgICAgIG9uTG9hZERvbmU6IGZ1bmN0aW9uKGJveCkge1xuICAgICAgICAgICAgfSAvL1doZW4gdGhlIHNvdXJjZSBoYXMgYmVlbiBsb2FkZWRcblxuICAgICAgICB9LCBvcHRpb25zKTtcblxuICAgICAgICAvL1RoZSBvdmVybGF5XG4gICAgICAgIHZhciBvdmVybGF5ID0gJCgnPGRpdiBjbGFzcz1cIm92ZXJsYXlcIj48L2Rpdj48ZGl2IGNsYXNzPVwibG9hZGluZy1pbWdcIj48L2Rpdj4nKTtcblxuICAgICAgICByZXR1cm4gdGhpcy5lYWNoKGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgLy9pZiBhIHNvdXJjZSBpcyBzcGVjaWZpZWRcbiAgICAgICAgICAgIGlmIChzZXR0aW5ncy5zb3VyY2UgPT09IFwiXCIpIHtcbiAgICAgICAgICAgICAgICBpZiAoY29uc29sZSkge1xuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhcIlBsZWFzZSBzcGVjaWZ5IGEgc291cmNlIGZpcnN0IC0gYm94UmVmcmVzaCgpXCIpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvL3RoZSBib3hcbiAgICAgICAgICAgIHZhciBib3ggPSAkKHRoaXMpO1xuICAgICAgICAgICAgLy90aGUgYnV0dG9uXG4gICAgICAgICAgICB2YXIgckJ0biA9IGJveC5maW5kKHNldHRpbmdzLnRyaWdnZXIpLmZpcnN0KCk7XG5cbiAgICAgICAgICAgIC8vT24gdHJpZ2dlciBjbGlja1xuICAgICAgICAgICAgckJ0bi5jbGljayhmdW5jdGlvbihlKSB7XG4gICAgICAgICAgICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgICAgICAgIC8vQWRkIGxvYWRpbmcgb3ZlcmxheVxuICAgICAgICAgICAgICAgIHN0YXJ0KGJveCk7XG5cbiAgICAgICAgICAgICAgICAvL1BlcmZvcm0gYWpheCBjYWxsXG4gICAgICAgICAgICAgICAgYm94LmZpbmQoXCIuYm94LWJvZHlcIikubG9hZChzZXR0aW5ncy5zb3VyY2UsIGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgICAgICBkb25lKGJveCk7XG4gICAgICAgICAgICAgICAgfSk7XG5cblxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgfSk7XG5cbiAgICAgICAgZnVuY3Rpb24gc3RhcnQoYm94KSB7XG4gICAgICAgICAgICAvL0FkZCBvdmVybGF5IGFuZCBsb2FkaW5nIGltZ1xuICAgICAgICAgICAgYm94LmFwcGVuZChvdmVybGF5KTtcblxuICAgICAgICAgICAgc2V0dGluZ3Mub25Mb2FkU3RhcnQuY2FsbChib3gpO1xuICAgICAgICB9XG5cbiAgICAgICAgZnVuY3Rpb24gZG9uZShib3gpIHtcbiAgICAgICAgICAgIC8vUmVtb3ZlIG92ZXJsYXkgYW5kIGxvYWRpbmcgaW1nXG4gICAgICAgICAgICBib3guZmluZChvdmVybGF5KS5yZW1vdmUoKTtcblxuICAgICAgICAgICAgc2V0dGluZ3Mub25Mb2FkRG9uZS5jYWxsKGJveCk7XG4gICAgICAgIH1cblxuICAgIH07XG5cbn0pKGpRdWVyeSk7XG5cbi8qXG4gKiBTSURFQkFSIE1FTlVcbiAqIC0tLS0tLS0tLS0tLVxuICogVGhpcyBpcyBhIGN1c3RvbSBwbHVnaW4gZm9yIHRoZSBzaWRlYmFyIG1lbnUuIEl0IHByb3ZpZGVzIGEgdHJlZSB2aWV3LlxuICogXG4gKiBVc2FnZTpcbiAqICQoXCIuc2lkZWJhcikudHJlZSgpO1xuICogXG4gKiBOb3RlOiBUaGlzIHBsdWdpbiBkb2VzIG5vdCBhY2NlcHQgYW55IG9wdGlvbnMuIEluc3RlYWQsIGl0IG9ubHkgcmVxdWlyZXMgYSBjbGFzc1xuICogICAgICAgYWRkZWQgdG8gdGhlIGVsZW1lbnQgdGhhdCBjb250YWlucyBhIHN1Yi1tZW51LlxuICogICAgICAgXG4gKiBXaGVuIHVzZWQgd2l0aCB0aGUgc2lkZWJhciwgZm9yIGV4YW1wbGUsIGl0IHdvdWxkIGxvb2sgc29tZXRoaW5nIGxpa2UgdGhpczpcbiAqIDx1bCBjbGFzcz0nc2lkZWJhci1tZW51Jz5cbiAqICAgICAgPGxpIGNsYXNzPVwidHJlZXZpZXcgYWN0aXZlXCI+XG4gKiAgICAgICAgICA8YSBocmVmPVwiIz5NZW51PC9hPlxuICogICAgICAgICAgPHVsIGNsYXNzPSd0cmVldmlldy1tZW51Jz5cbiAqICAgICAgICAgICAgICA8bGkgY2xhc3M9J2FjdGl2ZSc+PGEgaHJlZj0jPkxldmVsIDE8L2E+PC9saT5cbiAqICAgICAgICAgIDwvdWw+XG4gKiAgICAgIDwvbGk+XG4gKiA8L3VsPlxuICogXG4gKiBBZGQgLmFjdGl2ZSBjbGFzcyB0byA8bGk+IGVsZW1lbnRzIGlmIHlvdSB3YW50IHRoZSBtZW51IHRvIGJlIG9wZW4gYXV0b21hdGljYWxseVxuICogb24gcGFnZSBsb2FkLiBTZWUgYWJvdmUgZm9yIGFuIGV4YW1wbGUuXG4gKi9cbihmdW5jdGlvbigkKSB7XG4gICAgXCJ1c2Ugc3RyaWN0XCI7XG5cbiAgICAkLmZuLnRyZWUgPSBmdW5jdGlvbigpIHtcblxuICAgICAgICByZXR1cm4gdGhpcy5lYWNoKGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgdmFyIGJ0biA9ICQodGhpcykuY2hpbGRyZW4oXCJhXCIpLmZpcnN0KCk7XG4gICAgICAgICAgICB2YXIgbWVudSA9ICQodGhpcykuY2hpbGRyZW4oXCIudHJlZXZpZXctbWVudVwiKS5maXJzdCgpO1xuICAgICAgICAgICAgdmFyIGlzQWN0aXZlID0gJCh0aGlzKS5oYXNDbGFzcygnYWN0aXZlJyk7XG5cbiAgICAgICAgICAgIC8vaW5pdGlhbGl6ZSBhbHJlYWR5IGFjdGl2ZSBtZW51c1xuICAgICAgICAgICAgaWYgKGlzQWN0aXZlKSB7XG4gICAgICAgICAgICAgICAgbWVudS5zaG93KCk7XG4gICAgICAgICAgICAgICAgYnRuLmNoaWxkcmVuKFwiLmZhLWFuZ2xlLWxlZnRcIikuZmlyc3QoKS5yZW1vdmVDbGFzcyhcImZhLWFuZ2xlLWxlZnRcIikuYWRkQ2xhc3MoXCJmYS1hbmdsZS1kb3duXCIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy9TbGlkZSBvcGVuIG9yIGNsb3NlIHRoZSBtZW51IG9uIGxpbmsgY2xpY2tcbiAgICAgICAgICAgIGJ0bi5jbGljayhmdW5jdGlvbihlKSB7XG4gICAgICAgICAgICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgICAgICAgIGlmIChpc0FjdGl2ZSkge1xuICAgICAgICAgICAgICAgICAgICAvL1NsaWRlIHVwIHRvIGNsb3NlIG1lbnVcbiAgICAgICAgICAgICAgICAgICAgbWVudS5zbGlkZVVwKCk7XG4gICAgICAgICAgICAgICAgICAgIGlzQWN0aXZlID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgIGJ0bi5jaGlsZHJlbihcIi5mYS1hbmdsZS1kb3duXCIpLmZpcnN0KCkucmVtb3ZlQ2xhc3MoXCJmYS1hbmdsZS1kb3duXCIpLmFkZENsYXNzKFwiZmEtYW5nbGUtbGVmdFwiKTtcbiAgICAgICAgICAgICAgICAgICAgYnRuLnBhcmVudChcImxpXCIpLnJlbW92ZUNsYXNzKFwiYWN0aXZlXCIpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIC8vU2xpZGUgZG93biB0byBvcGVuIG1lbnVcbiAgICAgICAgICAgICAgICAgICAgbWVudS5zbGlkZURvd24oKTtcbiAgICAgICAgICAgICAgICAgICAgaXNBY3RpdmUgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICBidG4uY2hpbGRyZW4oXCIuZmEtYW5nbGUtbGVmdFwiKS5maXJzdCgpLnJlbW92ZUNsYXNzKFwiZmEtYW5nbGUtbGVmdFwiKS5hZGRDbGFzcyhcImZhLWFuZ2xlLWRvd25cIik7XG4gICAgICAgICAgICAgICAgICAgIGJ0bi5wYXJlbnQoXCJsaVwiKS5hZGRDbGFzcyhcImFjdGl2ZVwiKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLyogQWRkIG1hcmdpbnMgdG8gc3VibWVudSBlbGVtZW50cyB0byBnaXZlIGl0IGEgdHJlZSBsb29rICovXG4gICAgICAgICAgICBtZW51LmZpbmQoXCJsaSA+IGFcIikuZWFjaChmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICB2YXIgcGFkID0gcGFyc2VJbnQoJCh0aGlzKS5jc3MoXCJtYXJnaW4tbGVmdFwiKSkgKyAxMDtcblxuICAgICAgICAgICAgICAgICQodGhpcykuY3NzKHtcIm1hcmdpbi1sZWZ0XCI6IHBhZCArIFwicHhcIn0pO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgfSk7XG5cbiAgICB9O1xuXG5cbn0oalF1ZXJ5KSk7XG5cbi8qXG4gKiBUT0RPIExJU1QgQ1VTVE9NIFBMVUdJTlxuICogLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAqIFRoaXMgcGx1Z2luIGRlcGVuZHMgb24gaUNoZWNrIHBsdWdpbiBmb3IgY2hlY2tib3ggYW5kIHJhZGlvIGlucHV0c1xuICovXG4oZnVuY3Rpb24oJCkge1xuICAgIFwidXNlIHN0cmljdFwiO1xuXG4gICAgJC5mbi50b2RvbGlzdCA9IGZ1bmN0aW9uKG9wdGlvbnMpIHtcbiAgICAgICAgLy8gUmVuZGVyIG9wdGlvbnNcbiAgICAgICAgdmFyIHNldHRpbmdzID0gJC5leHRlbmQoe1xuICAgICAgICAgICAgLy9XaGVuIHRoZSB1c2VyIGNoZWNrcyB0aGUgaW5wdXRcbiAgICAgICAgICAgIG9uQ2hlY2s6IGZ1bmN0aW9uKGVsZSkge1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIC8vV2hlbiB0aGUgdXNlciB1bmNoZWNrcyB0aGUgaW5wdXRcbiAgICAgICAgICAgIG9uVW5jaGVjazogZnVuY3Rpb24oZWxlKSB7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sIG9wdGlvbnMpO1xuXG4gICAgICAgIHJldHVybiB0aGlzLmVhY2goZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAkKCdpbnB1dCcsIHRoaXMpLm9uKCdpZkNoZWNrZWQnLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgICAgICAgIHZhciBlbGUgPSAkKHRoaXMpLnBhcmVudHMoXCJsaVwiKS5maXJzdCgpO1xuICAgICAgICAgICAgICAgIGVsZS50b2dnbGVDbGFzcyhcImRvbmVcIik7XG4gICAgICAgICAgICAgICAgc2V0dGluZ3Mub25DaGVjay5jYWxsKGVsZSk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgJCgnaW5wdXQnLCB0aGlzKS5vbignaWZVbmNoZWNrZWQnLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgICAgICAgIHZhciBlbGUgPSAkKHRoaXMpLnBhcmVudHMoXCJsaVwiKS5maXJzdCgpO1xuICAgICAgICAgICAgICAgIGVsZS50b2dnbGVDbGFzcyhcImRvbmVcIik7XG4gICAgICAgICAgICAgICAgc2V0dGluZ3Mub25VbmNoZWNrLmNhbGwoZWxlKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG59KGpRdWVyeSkpO1xuXG4vKiBDRU5URVIgRUxFTUVOVFMgKi9cbihmdW5jdGlvbigkKSB7XG4gICAgXCJ1c2Ugc3RyaWN0XCI7XG4gICAgalF1ZXJ5LmZuLmNlbnRlciA9IGZ1bmN0aW9uKHBhcmVudCkge1xuICAgICAgICBpZiAocGFyZW50KSB7XG4gICAgICAgICAgICBwYXJlbnQgPSB0aGlzLnBhcmVudCgpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcGFyZW50ID0gd2luZG93O1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuY3NzKHtcbiAgICAgICAgICAgIFwicG9zaXRpb25cIjogXCJhYnNvbHV0ZVwiLFxuICAgICAgICAgICAgXCJ0b3BcIjogKCgoJChwYXJlbnQpLmhlaWdodCgpIC0gdGhpcy5vdXRlckhlaWdodCgpKSAvIDIpICsgJChwYXJlbnQpLnNjcm9sbFRvcCgpICsgXCJweFwiKSxcbiAgICAgICAgICAgIFwibGVmdFwiOiAoKCgkKHBhcmVudCkud2lkdGgoKSAtIHRoaXMub3V0ZXJXaWR0aCgpKSAvIDIpICsgJChwYXJlbnQpLnNjcm9sbExlZnQoKSArIFwicHhcIilcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cbn0oalF1ZXJ5KSk7XG5cbi8qXG4gKiBqUXVlcnkgcmVzaXplIGV2ZW50IC0gdjEuMSAtIDMvMTQvMjAxMFxuICogaHR0cDovL2JlbmFsbWFuLmNvbS9wcm9qZWN0cy9qcXVlcnktcmVzaXplLXBsdWdpbi9cbiAqIFxuICogQ29weXJpZ2h0IChjKSAyMDEwIFwiQ293Ym95XCIgQmVuIEFsbWFuXG4gKiBEdWFsIGxpY2Vuc2VkIHVuZGVyIHRoZSBNSVQgYW5kIEdQTCBsaWNlbnNlcy5cbiAqIGh0dHA6Ly9iZW5hbG1hbi5jb20vYWJvdXQvbGljZW5zZS9cbiAqL1xuKGZ1bmN0aW9uKCQsIGgsIGMpIHtcbiAgICB2YXIgYSA9ICQoW10pLCBlID0gJC5yZXNpemUgPSAkLmV4dGVuZCgkLnJlc2l6ZSwge30pLCBpLCBrID0gXCJzZXRUaW1lb3V0XCIsIGogPSBcInJlc2l6ZVwiLCBkID0gaiArIFwiLXNwZWNpYWwtZXZlbnRcIiwgYiA9IFwiZGVsYXlcIiwgZiA9IFwidGhyb3R0bGVXaW5kb3dcIjtcbiAgICBlW2JdID0gMjUwO1xuICAgIGVbZl0gPSB0cnVlO1xuICAgICQuZXZlbnQuc3BlY2lhbFtqXSA9IHtzZXR1cDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICBpZiAoIWVbZl0gJiYgdGhpc1trXSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZhciBsID0gJCh0aGlzKTtcbiAgICAgICAgICAgIGEgPSBhLmFkZChsKTtcbiAgICAgICAgICAgICQuZGF0YSh0aGlzLCBkLCB7dzogbC53aWR0aCgpLCBoOiBsLmhlaWdodCgpfSk7XG4gICAgICAgICAgICBpZiAoYS5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgICAgICAgICBnKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sIHRlYXJkb3duOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIGlmICghZVtmXSAmJiB0aGlzW2tdKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB2YXIgbCA9ICQodGhpcyk7XG4gICAgICAgICAgICBhID0gYS5ub3QobCk7XG4gICAgICAgICAgICBsLnJlbW92ZURhdGEoZCk7XG4gICAgICAgICAgICBpZiAoIWEubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgY2xlYXJUaW1lb3V0KGkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LCBhZGQ6IGZ1bmN0aW9uKGwpIHtcbiAgICAgICAgICAgIGlmICghZVtmXSAmJiB0aGlzW2tdKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB2YXIgbjtcbiAgICAgICAgICAgIGZ1bmN0aW9uIG0ocywgbywgcCkge1xuICAgICAgICAgICAgICAgIHZhciBxID0gJCh0aGlzKSwgciA9ICQuZGF0YSh0aGlzLCBkKTtcbiAgICAgICAgICAgICAgICByLncgPSBvICE9PSBjID8gbyA6IHEud2lkdGgoKTtcbiAgICAgICAgICAgICAgICByLmggPSBwICE9PSBjID8gcCA6IHEuaGVpZ2h0KCk7XG4gICAgICAgICAgICAgICAgbi5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoJC5pc0Z1bmN0aW9uKGwpKSB7XG4gICAgICAgICAgICAgICAgbiA9IGw7XG4gICAgICAgICAgICAgICAgcmV0dXJuIG1cbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgbiA9IGwuaGFuZGxlcjtcbiAgICAgICAgICAgICAgICBsLmhhbmRsZXIgPSBtXG4gICAgICAgICAgICB9XG4gICAgICAgIH19O1xuICAgIGZ1bmN0aW9uIGcoKSB7XG4gICAgICAgIGlmKHR5cGVvZiBoW2tdID09ICdmdW5jdGlvbicpe1xuICAgICAgICBpID0gaFtrXShmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIGEuZWFjaChmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICB2YXIgbiA9ICQodGhpcyksIG0gPSBuLndpZHRoKCksIGwgPSBuLmhlaWdodCgpLCBvID0gJC5kYXRhKHRoaXMsIGQpO1xuICAgICAgICAgICAgICAgIGlmIChtICE9PSBvLncgfHwgbCAhPT0gby5oKSB7XG4gICAgICAgICAgICAgICAgICAgIG4udHJpZ2dlcihqLCBbby53ID0gbSwgby5oID0gbF0pXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBnKClcbiAgICAgICAgfSwgZVtiXSlcbiAgICAgICAgfVxuICAgIH19XG4pKGpRdWVyeSwgdGhpcyk7XG5cbi8qIVxuICogU2xpbVNjcm9sbCBodHRwczovL2dpdGh1Yi5jb20vcm9jaGFsL2pRdWVyeS1zbGltU2Nyb2xsXG4gKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gKiBcbiAqIENvcHlyaWdodCAoYykgMjAxMSBQaW90ciBSb2NoYWxhIChodHRwOi8vcm9jaGEubGEpIER1YWwgbGljZW5zZWQgdW5kZXIgdGhlIE1JVCBcbiAqL1xuKGZ1bmN0aW9uKGYpIHtcbiAgICBqUXVlcnkuZm4uZXh0ZW5kKHtzbGltU2Nyb2xsOiBmdW5jdGlvbihoKSB7XG4gICAgICAgICAgICB2YXIgYSA9IGYuZXh0ZW5kKHt3aWR0aDogXCJhdXRvXCIsIGhlaWdodDogXCIyNTBweFwiLCBzaXplOiBcIjdweFwiLCBjb2xvcjogXCIjMDAwXCIsIHBvc2l0aW9uOiBcInJpZ2h0XCIsIGRpc3RhbmNlOiBcIjFweFwiLCBzdGFydDogXCJ0b3BcIiwgb3BhY2l0eTogMC40LCBhbHdheXNWaXNpYmxlOiAhMSwgZGlzYWJsZUZhZGVPdXQ6ICExLCByYWlsVmlzaWJsZTogITEsIHJhaWxDb2xvcjogXCIjMzMzXCIsIHJhaWxPcGFjaXR5OiAwLjIsIHJhaWxEcmFnZ2FibGU6ICEwLCByYWlsQ2xhc3M6IFwic2xpbVNjcm9sbFJhaWxcIiwgYmFyQ2xhc3M6IFwic2xpbVNjcm9sbEJhclwiLCB3cmFwcGVyQ2xhc3M6IFwic2xpbVNjcm9sbERpdlwiLCBhbGxvd1BhZ2VTY3JvbGw6ICExLCB3aGVlbFN0ZXA6IDIwLCB0b3VjaFNjcm9sbFN0ZXA6IDIwMCwgYm9yZGVyUmFkaXVzOiBcIjBweFwiLCByYWlsQm9yZGVyUmFkaXVzOiBcIjBweFwifSwgaCk7XG4gICAgICAgICAgICB0aGlzLmVhY2goZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgZnVuY3Rpb24gcihkKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChzKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBkID0gZCB8fFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB3aW5kb3cuZXZlbnQ7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YXIgYyA9IDA7XG4gICAgICAgICAgICAgICAgICAgICAgICBkLndoZWVsRGVsdGEgJiYgKGMgPSAtZC53aGVlbERlbHRhIC8gMTIwKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGQuZGV0YWlsICYmIChjID0gZC5kZXRhaWwgLyAzKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGYoZC50YXJnZXQgfHwgZC5zcmNUYXJnZXQgfHwgZC5zcmNFbGVtZW50KS5jbG9zZXN0KFwiLlwiICsgYS53cmFwcGVyQ2xhc3MpLmlzKGIucGFyZW50KCkpICYmIG0oYywgITApO1xuICAgICAgICAgICAgICAgICAgICAgICAgZC5wcmV2ZW50RGVmYXVsdCAmJiAhayAmJiBkLnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBrIHx8IChkLnJldHVyblZhbHVlID0gITEpXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZnVuY3Rpb24gbShkLCBmLCBoKSB7XG4gICAgICAgICAgICAgICAgICAgIGsgPSAhMTtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGUgPSBkLCBnID0gYi5vdXRlckhlaWdodCgpIC0gYy5vdXRlckhlaWdodCgpO1xuICAgICAgICAgICAgICAgICAgICBmICYmIChlID0gcGFyc2VJbnQoYy5jc3MoXCJ0b3BcIikpICsgZCAqIHBhcnNlSW50KGEud2hlZWxTdGVwKSAvIDEwMCAqIGMub3V0ZXJIZWlnaHQoKSwgZSA9IE1hdGgubWluKE1hdGgubWF4KGUsIDApLCBnKSwgZSA9IDAgPCBkID8gTWF0aC5jZWlsKGUpIDogTWF0aC5mbG9vcihlKSwgYy5jc3Moe3RvcDogZSArIFwicHhcIn0pKTtcbiAgICAgICAgICAgICAgICAgICAgbCA9IHBhcnNlSW50KGMuY3NzKFwidG9wXCIpKSAvIChiLm91dGVySGVpZ2h0KCkgLSBjLm91dGVySGVpZ2h0KCkpO1xuICAgICAgICAgICAgICAgICAgICBlID0gbCAqIChiWzBdLnNjcm9sbEhlaWdodCAtIGIub3V0ZXJIZWlnaHQoKSk7XG4gICAgICAgICAgICAgICAgICAgIGggJiYgKGUgPSBkLCBkID0gZSAvIGJbMF0uc2Nyb2xsSGVpZ2h0ICogYi5vdXRlckhlaWdodCgpLCBkID0gTWF0aC5taW4oTWF0aC5tYXgoZCwgMCksIGcpLCBjLmNzcyh7dG9wOiBkICsgXCJweFwifSkpO1xuICAgICAgICAgICAgICAgICAgICBiLnNjcm9sbFRvcChlKTtcbiAgICAgICAgICAgICAgICAgICAgYi50cmlnZ2VyKFwic2xpbXNjcm9sbGluZ1wiLCB+fmUpO1xuICAgICAgICAgICAgICAgICAgICB2KCk7XG4gICAgICAgICAgICAgICAgICAgIHAoKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBmdW5jdGlvbiBDKCkge1xuICAgICAgICAgICAgICAgICAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lciA/ICh0aGlzLmFkZEV2ZW50TGlzdGVuZXIoXCJET01Nb3VzZVNjcm9sbFwiLCByLCAhMSksIHRoaXMuYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNld2hlZWxcIiwgciwgITEpLCB0aGlzLmFkZEV2ZW50TGlzdGVuZXIoXCJNb3pNb3VzZVBpeGVsU2Nyb2xsXCIsIHIsICExKSkgOiBkb2N1bWVudC5hdHRhY2hFdmVudChcIm9ubW91c2V3aGVlbFwiLCByKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBmdW5jdGlvbiB3KCkge1xuICAgICAgICAgICAgICAgICAgICB1ID0gTWF0aC5tYXgoYi5vdXRlckhlaWdodCgpIC8gYlswXS5zY3JvbGxIZWlnaHQgKiBiLm91dGVySGVpZ2h0KCksIEQpO1xuICAgICAgICAgICAgICAgICAgICBjLmNzcyh7aGVpZ2h0OiB1ICsgXCJweFwifSk7XG4gICAgICAgICAgICAgICAgICAgIHZhciBhID0gdSA9PSBiLm91dGVySGVpZ2h0KCkgPyBcIm5vbmVcIiA6IFwiYmxvY2tcIjtcbiAgICAgICAgICAgICAgICAgICAgYy5jc3Moe2Rpc3BsYXk6IGF9KVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBmdW5jdGlvbiB2KCkge1xuICAgICAgICAgICAgICAgICAgICB3KCk7XG4gICAgICAgICAgICAgICAgICAgIGNsZWFyVGltZW91dChBKTtcbiAgICAgICAgICAgICAgICAgICAgbCA9PSB+fmwgPyAoayA9IGEuYWxsb3dQYWdlU2Nyb2xsLCBCICE9IGwgJiYgYi50cmlnZ2VyKFwic2xpbXNjcm9sbFwiLCAwID09IH5+bCA/IFwidG9wXCIgOiBcImJvdHRvbVwiKSkgOiBrID0gITE7XG4gICAgICAgICAgICAgICAgICAgIEIgPSBsO1xuICAgICAgICAgICAgICAgICAgICB1ID49IGIub3V0ZXJIZWlnaHQoKSA/IGsgPSAhMCA6IChjLnN0b3AoITAsICEwKS5mYWRlSW4oXCJmYXN0XCIpLCBhLnJhaWxWaXNpYmxlICYmIGcuc3RvcCghMCwgITApLmZhZGVJbihcImZhc3RcIikpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGZ1bmN0aW9uIHAoKSB7XG4gICAgICAgICAgICAgICAgICAgIGEuYWx3YXlzVmlzaWJsZSB8fCAoQSA9IHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBhLmRpc2FibGVGYWRlT3V0ICYmIHMgfHwgKHggfHwgeSkgfHwgKGMuZmFkZU91dChcInNsb3dcIiksIGcuZmFkZU91dChcInNsb3dcIikpXG4gICAgICAgICAgICAgICAgICAgIH0sIDFFMykpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHZhciBzLCB4LCB5LCBBLCB6LCB1LCBsLCBCLCBEID0gMzAsIGsgPSAhMSwgYiA9IGYodGhpcyk7XG4gICAgICAgICAgICAgICAgaWYgKGIucGFyZW50KCkuaGFzQ2xhc3MoYS53cmFwcGVyQ2xhc3MpKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBuID0gYi5zY3JvbGxUb3AoKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjID0gYi5wYXJlbnQoKS5maW5kKFwiLlwiICsgYS5iYXJDbGFzcyksIGcgPSBiLnBhcmVudCgpLmZpbmQoXCIuXCIgKyBhLnJhaWxDbGFzcyk7XG4gICAgICAgICAgICAgICAgICAgIHcoKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGYuaXNQbGFpbk9iamVjdChoKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKFwiaGVpZ2h0XCJpbiBoICYmIFwiYXV0b1wiID09IGguaGVpZ2h0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYi5wYXJlbnQoKS5jc3MoXCJoZWlnaHRcIiwgXCJhdXRvXCIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGIuY3NzKFwiaGVpZ2h0XCIsIFwiYXV0b1wiKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YXIgcSA9IGIucGFyZW50KCkucGFyZW50KCkuaGVpZ2h0KCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYi5wYXJlbnQoKS5jc3MoXCJoZWlnaHRcIiwgcSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYi5jc3MoXCJoZWlnaHRcIiwgcSlcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChcInNjcm9sbFRvXCJpbiBoKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG4gPSBwYXJzZUludChhLnNjcm9sbFRvKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGVsc2UgaWYgKFwic2Nyb2xsQnlcImluIGgpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbiArPSBwYXJzZUludChhLnNjcm9sbEJ5KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGVsc2UgaWYgKFwiZGVzdHJveVwiaW4gaCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGMucmVtb3ZlKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZy5yZW1vdmUoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBiLnVud3JhcCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVyblxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgbShuLCAhMSwgITApXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBhLmhlaWdodCA9IFwiYXV0b1wiID09IGEuaGVpZ2h0ID8gYi5wYXJlbnQoKS5oZWlnaHQoKSA6IGEuaGVpZ2h0O1xuICAgICAgICAgICAgICAgICAgICBuID0gZihcIjxkaXY+PC9kaXY+XCIpLmFkZENsYXNzKGEud3JhcHBlckNsYXNzKS5jc3Moe3Bvc2l0aW9uOiBcInJlbGF0aXZlXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBvdmVyZmxvdzogXCJoaWRkZW5cIiwgd2lkdGg6IGEud2lkdGgsIGhlaWdodDogYS5oZWlnaHR9KTtcbiAgICAgICAgICAgICAgICAgICAgYi5jc3Moe292ZXJmbG93OiBcImhpZGRlblwiLCB3aWR0aDogYS53aWR0aCwgaGVpZ2h0OiBhLmhlaWdodH0pO1xuICAgICAgICAgICAgICAgICAgICB2YXIgZyA9IGYoXCI8ZGl2PjwvZGl2PlwiKS5hZGRDbGFzcyhhLnJhaWxDbGFzcykuY3NzKHt3aWR0aDogYS5zaXplLCBoZWlnaHQ6IFwiMTAwJVwiLCBwb3NpdGlvbjogXCJhYnNvbHV0ZVwiLCB0b3A6IDAsIGRpc3BsYXk6IGEuYWx3YXlzVmlzaWJsZSAmJiBhLnJhaWxWaXNpYmxlID8gXCJibG9ja1wiIDogXCJub25lXCIsIFwiYm9yZGVyLXJhZGl1c1wiOiBhLnJhaWxCb3JkZXJSYWRpdXMsIGJhY2tncm91bmQ6IGEucmFpbENvbG9yLCBvcGFjaXR5OiBhLnJhaWxPcGFjaXR5LCB6SW5kZXg6IDkwfSksIGMgPSBmKFwiPGRpdj48L2Rpdj5cIikuYWRkQ2xhc3MoYS5iYXJDbGFzcykuY3NzKHtiYWNrZ3JvdW5kOiBhLmNvbG9yLCB3aWR0aDogYS5zaXplLCBwb3NpdGlvbjogXCJhYnNvbHV0ZVwiLCB0b3A6IDAsIG9wYWNpdHk6IGEub3BhY2l0eSwgZGlzcGxheTogYS5hbHdheXNWaXNpYmxlID9cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXCJibG9ja1wiIDogXCJub25lXCIsIFwiYm9yZGVyLXJhZGl1c1wiOiBhLmJvcmRlclJhZGl1cywgQm9yZGVyUmFkaXVzOiBhLmJvcmRlclJhZGl1cywgTW96Qm9yZGVyUmFkaXVzOiBhLmJvcmRlclJhZGl1cywgV2Via2l0Qm9yZGVyUmFkaXVzOiBhLmJvcmRlclJhZGl1cywgekluZGV4OiA5OX0pLCBxID0gXCJyaWdodFwiID09IGEucG9zaXRpb24gPyB7cmlnaHQ6IGEuZGlzdGFuY2V9IDoge2xlZnQ6IGEuZGlzdGFuY2V9O1xuICAgICAgICAgICAgICAgICAgICBnLmNzcyhxKTtcbiAgICAgICAgICAgICAgICAgICAgYy5jc3MocSk7XG4gICAgICAgICAgICAgICAgICAgIGIud3JhcChuKTtcbiAgICAgICAgICAgICAgICAgICAgYi5wYXJlbnQoKS5hcHBlbmQoYyk7XG4gICAgICAgICAgICAgICAgICAgIGIucGFyZW50KCkuYXBwZW5kKGcpO1xuICAgICAgICAgICAgICAgICAgICBhLnJhaWxEcmFnZ2FibGUgJiYgYy5iaW5kKFwibW91c2Vkb3duXCIsIGZ1bmN0aW9uKGEpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBiID0gZihkb2N1bWVudCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB5ID0gITA7XG4gICAgICAgICAgICAgICAgICAgICAgICB0ID0gcGFyc2VGbG9hdChjLmNzcyhcInRvcFwiKSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBwYWdlWSA9IGEucGFnZVk7XG4gICAgICAgICAgICAgICAgICAgICAgICBiLmJpbmQoXCJtb3VzZW1vdmUuc2xpbXNjcm9sbFwiLCBmdW5jdGlvbihhKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY3VyclRvcCA9IHQgKyBhLnBhZ2VZIC0gcGFnZVk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYy5jc3MoXCJ0b3BcIiwgY3VyclRvcCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbSgwLCBjLnBvc2l0aW9uKCkudG9wLCAhMSlcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgYi5iaW5kKFwibW91c2V1cC5zbGltc2Nyb2xsXCIsIGZ1bmN0aW9uKGEpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB5ID0gITE7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGIudW5iaW5kKFwiLnNsaW1zY3JvbGxcIilcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuITFcbiAgICAgICAgICAgICAgICAgICAgfSkuYmluZChcInNlbGVjdHN0YXJ0LnNsaW1zY3JvbGxcIiwgZnVuY3Rpb24oYSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgYS5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGEucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiExXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICBnLmhvdmVyKGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdigpXG4gICAgICAgICAgICAgICAgICAgIH0sIGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcCgpXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICBjLmhvdmVyKGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgeCA9ICEwXG4gICAgICAgICAgICAgICAgICAgIH0sIGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgeCA9ICExXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICBiLmhvdmVyKGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcyA9ICEwO1xuICAgICAgICAgICAgICAgICAgICAgICAgdigpO1xuICAgICAgICAgICAgICAgICAgICAgICAgcCgpXG4gICAgICAgICAgICAgICAgICAgIH0sIGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcyA9ICExO1xuICAgICAgICAgICAgICAgICAgICAgICAgcCgpXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICBiLmJpbmQoXCJ0b3VjaHN0YXJ0XCIsIGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGEub3JpZ2luYWxFdmVudC50b3VjaGVzLmxlbmd0aCAmJiAoeiA9IGEub3JpZ2luYWxFdmVudC50b3VjaGVzWzBdLnBhZ2VZKVxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgYi5iaW5kKFwidG91Y2htb3ZlXCIsIGZ1bmN0aW9uKGIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGsgfHwgYi5vcmlnaW5hbEV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBiLm9yaWdpbmFsRXZlbnQudG91Y2hlcy5sZW5ndGggJiZcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKG0oKHogLSBiLm9yaWdpbmFsRXZlbnQudG91Y2hlc1swXS5wYWdlWSkgLyBhLnRvdWNoU2Nyb2xsU3RlcCwgITApLCB6ID0gYi5vcmlnaW5hbEV2ZW50LnRvdWNoZXNbMF0ucGFnZVkpXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICB3KCk7XG4gICAgICAgICAgICAgICAgICAgIFwiYm90dG9tXCIgPT09IGEuc3RhcnQgPyAoYy5jc3Moe3RvcDogYi5vdXRlckhlaWdodCgpIC0gYy5vdXRlckhlaWdodCgpfSksIG0oMCwgITApKSA6IFwidG9wXCIgIT09IGEuc3RhcnQgJiYgKG0oZihhLnN0YXJ0KS5wb3NpdGlvbigpLnRvcCwgbnVsbCwgITApLCBhLmFsd2F5c1Zpc2libGUgfHwgYy5oaWRlKCkpO1xuICAgICAgICAgICAgICAgICAgICBDKClcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybiB0aGlzXG4gICAgICAgIH19KTtcbiAgICBqUXVlcnkuZm4uZXh0ZW5kKHtzbGltc2Nyb2xsOiBqUXVlcnkuZm4uc2xpbVNjcm9sbH0pXG59KShqUXVlcnkpO1xuXG4vKiEgaUNoZWNrIHYxLjAuMSBieSBEYW1pciBTdWx0YW5vdiwgaHR0cDovL2dpdC5pby9hcmx6ZUEsIE1JVCBMaWNlbnNlZCAqL1xuKGZ1bmN0aW9uKGgpIHtcbiAgICBmdW5jdGlvbiBGKGEsIGIsIGQpIHtcbiAgICAgICAgdmFyIGMgPSBhWzBdLCBlID0gL2VyLy50ZXN0KGQpID8gbSA6IC9ibC8udGVzdChkKSA/IHMgOiBsLCBmID0gZCA9PSBIID8ge2NoZWNrZWQ6IGNbbF0sIGRpc2FibGVkOiBjW3NdLCBpbmRldGVybWluYXRlOiBcInRydWVcIiA9PSBhLmF0dHIobSkgfHwgXCJmYWxzZVwiID09IGEuYXR0cih3KX0gOiBjW2VdO1xuICAgICAgICBpZiAoL14oY2h8ZGl8aW4pLy50ZXN0KGQpICYmICFmKVxuICAgICAgICAgICAgRChhLCBlKTtcbiAgICAgICAgZWxzZSBpZiAoL14odW58ZW58ZGUpLy50ZXN0KGQpICYmIGYpXG4gICAgICAgICAgICB0KGEsIGUpO1xuICAgICAgICBlbHNlIGlmIChkID09IEgpXG4gICAgICAgICAgICBmb3IgKGUgaW4gZilcbiAgICAgICAgICAgICAgICBmW2VdID8gRChhLCBlLCAhMCkgOiB0KGEsIGUsICEwKTtcbiAgICAgICAgZWxzZSBpZiAoIWIgfHwgXCJ0b2dnbGVcIiA9PSBkKSB7XG4gICAgICAgICAgICBpZiAoIWIpXG4gICAgICAgICAgICAgICAgYVtwXShcImlmQ2xpY2tlZFwiKTtcbiAgICAgICAgICAgIGYgPyBjW25dICE9PSB1ICYmIHQoYSwgZSkgOiBEKGEsIGUpXG4gICAgICAgIH1cbiAgICB9XG4gICAgZnVuY3Rpb24gRChhLCBiLCBkKSB7XG4gICAgICAgIHZhciBjID0gYVswXSwgZSA9IGEucGFyZW50KCksIGYgPSBiID09IGwsIEEgPSBiID09IG0sIEIgPSBiID09IHMsIEsgPSBBID8gdyA6IGYgPyBFIDogXCJlbmFibGVkXCIsIHAgPSBrKGEsIEsgKyB4KGNbbl0pKSwgTiA9IGsoYSwgYiArIHgoY1tuXSkpO1xuICAgICAgICBpZiAoITAgIT09IGNbYl0pIHtcbiAgICAgICAgICAgIGlmICghZCAmJlxuICAgICAgICAgICAgICAgICAgICBiID09IGwgJiYgY1tuXSA9PSB1ICYmIGMubmFtZSkge1xuICAgICAgICAgICAgICAgIHZhciBDID0gYS5jbG9zZXN0KFwiZm9ybVwiKSwgciA9ICdpbnB1dFtuYW1lPVwiJyArIGMubmFtZSArICdcIl0nLCByID0gQy5sZW5ndGggPyBDLmZpbmQocikgOiBoKHIpO1xuICAgICAgICAgICAgICAgIHIuZWFjaChmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcyAhPT0gYyAmJiBoKHRoaXMpLmRhdGEocSkgJiYgdChoKHRoaXMpLCBiKVxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBBID8gKGNbYl0gPSAhMCwgY1tsXSAmJiB0KGEsIGwsIFwiZm9yY2VcIikpIDogKGQgfHwgKGNbYl0gPSAhMCksIGYgJiYgY1ttXSAmJiB0KGEsIG0sICExKSk7XG4gICAgICAgICAgICBMKGEsIGYsIGIsIGQpXG4gICAgICAgIH1cbiAgICAgICAgY1tzXSAmJiBrKGEsIHksICEwKSAmJiBlLmZpbmQoXCIuXCIgKyBJKS5jc3MoeSwgXCJkZWZhdWx0XCIpO1xuICAgICAgICBlW3ZdKE4gfHwgayhhLCBiKSB8fCBcIlwiKTtcbiAgICAgICAgQiA/IGUuYXR0cihcImFyaWEtZGlzYWJsZWRcIiwgXCJ0cnVlXCIpIDogZS5hdHRyKFwiYXJpYS1jaGVja2VkXCIsIEEgPyBcIm1peGVkXCIgOiBcInRydWVcIik7XG4gICAgICAgIGVbel0ocCB8fCBrKGEsIEspIHx8IFwiXCIpXG4gICAgfVxuICAgIGZ1bmN0aW9uIHQoYSwgYiwgZCkge1xuICAgICAgICB2YXIgYyA9IGFbMF0sIGUgPSBhLnBhcmVudCgpLCBmID0gYiA9PSBsLCBoID0gYiA9PSBtLCBxID0gYiA9PSBzLCBwID0gaCA/IHcgOiBmID8gRSA6IFwiZW5hYmxlZFwiLCB0ID0gayhhLCBwICsgeChjW25dKSksXG4gICAgICAgICAgICAgICAgdSA9IGsoYSwgYiArIHgoY1tuXSkpO1xuICAgICAgICBpZiAoITEgIT09IGNbYl0pIHtcbiAgICAgICAgICAgIGlmIChoIHx8ICFkIHx8IFwiZm9yY2VcIiA9PSBkKVxuICAgICAgICAgICAgICAgIGNbYl0gPSAhMTtcbiAgICAgICAgICAgIEwoYSwgZiwgcCwgZClcbiAgICAgICAgfVxuICAgICAgICAhY1tzXSAmJiBrKGEsIHksICEwKSAmJiBlLmZpbmQoXCIuXCIgKyBJKS5jc3MoeSwgXCJwb2ludGVyXCIpO1xuICAgICAgICBlW3pdKHUgfHwgayhhLCBiKSB8fCBcIlwiKTtcbiAgICAgICAgcSA/IGUuYXR0cihcImFyaWEtZGlzYWJsZWRcIiwgXCJmYWxzZVwiKSA6IGUuYXR0cihcImFyaWEtY2hlY2tlZFwiLCBcImZhbHNlXCIpO1xuICAgICAgICBlW3ZdKHQgfHwgayhhLCBwKSB8fCBcIlwiKVxuICAgIH1cbiAgICBmdW5jdGlvbiBNKGEsIGIpIHtcbiAgICAgICAgaWYgKGEuZGF0YShxKSkge1xuICAgICAgICAgICAgYS5wYXJlbnQoKS5odG1sKGEuYXR0cihcInN0eWxlXCIsIGEuZGF0YShxKS5zIHx8IFwiXCIpKTtcbiAgICAgICAgICAgIGlmIChiKVxuICAgICAgICAgICAgICAgIGFbcF0oYik7XG4gICAgICAgICAgICBhLm9mZihcIi5pXCIpLnVud3JhcCgpO1xuICAgICAgICAgICAgaChHICsgJ1tmb3I9XCInICsgYVswXS5pZCArICdcIl0nKS5hZGQoYS5jbG9zZXN0KEcpKS5vZmYoXCIuaVwiKVxuICAgICAgICB9XG4gICAgfVxuICAgIGZ1bmN0aW9uIGsoYSwgYiwgZCkge1xuICAgICAgICBpZiAoYS5kYXRhKHEpKVxuICAgICAgICAgICAgcmV0dXJuIGEuZGF0YShxKS5vW2IgKyAoZCA/IFwiXCIgOiBcIkNsYXNzXCIpXVxuICAgIH1cbiAgICBmdW5jdGlvbiB4KGEpIHtcbiAgICAgICAgcmV0dXJuIGEuY2hhckF0KDApLnRvVXBwZXJDYXNlKCkgK1xuICAgICAgICAgICAgICAgIGEuc2xpY2UoMSlcbiAgICB9XG4gICAgZnVuY3Rpb24gTChhLCBiLCBkLCBjKSB7XG4gICAgICAgIGlmICghYykge1xuICAgICAgICAgICAgaWYgKGIpXG4gICAgICAgICAgICAgICAgYVtwXShcImlmVG9nZ2xlZFwiKTtcbiAgICAgICAgICAgIGFbcF0oXCJpZkNoYW5nZWRcIilbcF0oXCJpZlwiICsgeChkKSlcbiAgICAgICAgfVxuICAgIH1cbiAgICB2YXIgcSA9IFwiaUNoZWNrXCIsIEkgPSBxICsgXCItaGVscGVyXCIsIHUgPSBcInJhZGlvXCIsIGwgPSBcImNoZWNrZWRcIiwgRSA9IFwidW5cIiArIGwsIHMgPSBcImRpc2FibGVkXCIsIHcgPSBcImRldGVybWluYXRlXCIsIG0gPSBcImluXCIgKyB3LCBIID0gXCJ1cGRhdGVcIiwgbiA9IFwidHlwZVwiLCB2ID0gXCJhZGRDbGFzc1wiLCB6ID0gXCJyZW1vdmVDbGFzc1wiLCBwID0gXCJ0cmlnZ2VyXCIsIEcgPSBcImxhYmVsXCIsIHkgPSBcImN1cnNvclwiLCBKID0gL2lwYWR8aXBob25lfGlwb2R8YW5kcm9pZHxibGFja2JlcnJ5fHdpbmRvd3MgcGhvbmV8b3BlcmEgbWluaXxzaWxrL2kudGVzdChuYXZpZ2F0b3IudXNlckFnZW50KTtcbiAgICBoLmZuW3FdID0gZnVuY3Rpb24oYSwgYikge1xuICAgICAgICB2YXIgZCA9ICdpbnB1dFt0eXBlPVwiY2hlY2tib3hcIl0sIGlucHV0W3R5cGU9XCInICsgdSArICdcIl0nLCBjID0gaCgpLCBlID0gZnVuY3Rpb24oYSkge1xuICAgICAgICAgICAgYS5lYWNoKGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgIHZhciBhID0gaCh0aGlzKTtcbiAgICAgICAgICAgICAgICBjID0gYS5pcyhkKSA/XG4gICAgICAgICAgICAgICAgICAgICAgICBjLmFkZChhKSA6IGMuYWRkKGEuZmluZChkKSlcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH07XG4gICAgICAgIGlmICgvXihjaGVja3x1bmNoZWNrfHRvZ2dsZXxpbmRldGVybWluYXRlfGRldGVybWluYXRlfGRpc2FibGV8ZW5hYmxlfHVwZGF0ZXxkZXN0cm95KSQvaS50ZXN0KGEpKVxuICAgICAgICAgICAgcmV0dXJuIGEgPSBhLnRvTG93ZXJDYXNlKCksIGUodGhpcyksIGMuZWFjaChmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICB2YXIgYyA9IGgodGhpcyk7XG4gICAgICAgICAgICAgICAgXCJkZXN0cm95XCIgPT0gYSA/IE0oYywgXCJpZkRlc3Ryb3llZFwiKSA6IEYoYywgITAsIGEpO1xuICAgICAgICAgICAgICAgIGguaXNGdW5jdGlvbihiKSAmJiBiKClcbiAgICAgICAgICAgIH0pO1xuICAgICAgICBpZiAoXCJvYmplY3RcIiAhPSB0eXBlb2YgYSAmJiBhKVxuICAgICAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgICAgIHZhciBmID0gaC5leHRlbmQoe2NoZWNrZWRDbGFzczogbCwgZGlzYWJsZWRDbGFzczogcywgaW5kZXRlcm1pbmF0ZUNsYXNzOiBtLCBsYWJlbEhvdmVyOiAhMCwgYXJpYTogITF9LCBhKSwgayA9IGYuaGFuZGxlLCBCID0gZi5ob3ZlckNsYXNzIHx8IFwiaG92ZXJcIiwgeCA9IGYuZm9jdXNDbGFzcyB8fCBcImZvY3VzXCIsIHcgPSBmLmFjdGl2ZUNsYXNzIHx8IFwiYWN0aXZlXCIsIHkgPSAhIWYubGFiZWxIb3ZlciwgQyA9IGYubGFiZWxIb3ZlckNsYXNzIHx8XG4gICAgICAgICAgICAgICAgXCJob3ZlclwiLCByID0gKFwiXCIgKyBmLmluY3JlYXNlQXJlYSkucmVwbGFjZShcIiVcIiwgXCJcIikgfCAwO1xuICAgICAgICBpZiAoXCJjaGVja2JveFwiID09IGsgfHwgayA9PSB1KVxuICAgICAgICAgICAgZCA9ICdpbnB1dFt0eXBlPVwiJyArIGsgKyAnXCJdJztcbiAgICAgICAgLTUwID4gciAmJiAociA9IC01MCk7XG4gICAgICAgIGUodGhpcyk7XG4gICAgICAgIHJldHVybiBjLmVhY2goZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICB2YXIgYSA9IGgodGhpcyk7XG4gICAgICAgICAgICBNKGEpO1xuICAgICAgICAgICAgdmFyIGMgPSB0aGlzLCBiID0gYy5pZCwgZSA9IC1yICsgXCIlXCIsIGQgPSAxMDAgKyAyICogciArIFwiJVwiLCBkID0ge3Bvc2l0aW9uOiBcImFic29sdXRlXCIsIHRvcDogZSwgbGVmdDogZSwgZGlzcGxheTogXCJibG9ja1wiLCB3aWR0aDogZCwgaGVpZ2h0OiBkLCBtYXJnaW46IDAsIHBhZGRpbmc6IDAsIGJhY2tncm91bmQ6IFwiI2ZmZlwiLCBib3JkZXI6IDAsIG9wYWNpdHk6IDB9LCBlID0gSiA/IHtwb3NpdGlvbjogXCJhYnNvbHV0ZVwiLCB2aXNpYmlsaXR5OiBcImhpZGRlblwifSA6IHIgPyBkIDoge3Bvc2l0aW9uOiBcImFic29sdXRlXCIsIG9wYWNpdHk6IDB9LCBrID0gXCJjaGVja2JveFwiID09IGNbbl0gPyBmLmNoZWNrYm94Q2xhc3MgfHwgXCJpY2hlY2tib3hcIiA6IGYucmFkaW9DbGFzcyB8fCBcImlcIiArIHUsIG0gPSBoKEcgKyAnW2Zvcj1cIicgKyBiICsgJ1wiXScpLmFkZChhLmNsb3Nlc3QoRykpLFxuICAgICAgICAgICAgICAgICAgICBBID0gISFmLmFyaWEsIEUgPSBxICsgXCItXCIgKyBNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5yZXBsYWNlKFwiMC5cIiwgXCJcIiksIGcgPSAnPGRpdiBjbGFzcz1cIicgKyBrICsgJ1wiICcgKyAoQSA/ICdyb2xlPVwiJyArIGNbbl0gKyAnXCIgJyA6IFwiXCIpO1xuICAgICAgICAgICAgbS5sZW5ndGggJiYgQSAmJiBtLmVhY2goZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgZyArPSAnYXJpYS1sYWJlbGxlZGJ5PVwiJztcbiAgICAgICAgICAgICAgICB0aGlzLmlkID8gZyArPSB0aGlzLmlkIDogKHRoaXMuaWQgPSBFLCBnICs9IEUpO1xuICAgICAgICAgICAgICAgIGcgKz0gJ1wiJ1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBnID0gYS53cmFwKGcgKyBcIi8+XCIpW3BdKFwiaWZDcmVhdGVkXCIpLnBhcmVudCgpLmFwcGVuZChmLmluc2VydCk7XG4gICAgICAgICAgICBkID0gaCgnPGlucyBjbGFzcz1cIicgKyBJICsgJ1wiLz4nKS5jc3MoZCkuYXBwZW5kVG8oZyk7XG4gICAgICAgICAgICBhLmRhdGEocSwge286IGYsIHM6IGEuYXR0cihcInN0eWxlXCIpfSkuY3NzKGUpO1xuICAgICAgICAgICAgZi5pbmhlcml0Q2xhc3MgJiYgZ1t2XShjLmNsYXNzTmFtZSB8fCBcIlwiKTtcbiAgICAgICAgICAgIGYuaW5oZXJpdElEICYmIGIgJiYgZy5hdHRyKFwiaWRcIiwgcSArIFwiLVwiICsgYik7XG4gICAgICAgICAgICBcInN0YXRpY1wiID09IGcuY3NzKFwicG9zaXRpb25cIikgJiYgZy5jc3MoXCJwb3NpdGlvblwiLCBcInJlbGF0aXZlXCIpO1xuICAgICAgICAgICAgRihhLCAhMCwgSCk7XG4gICAgICAgICAgICBpZiAobS5sZW5ndGgpXG4gICAgICAgICAgICAgICAgbS5vbihcImNsaWNrLmkgbW91c2VvdmVyLmkgbW91c2VvdXQuaSB0b3VjaGJlZ2luLmkgdG91Y2hlbmQuaVwiLCBmdW5jdGlvbihiKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBkID0gYltuXSwgZSA9IGgodGhpcyk7XG4gICAgICAgICAgICAgICAgICAgIGlmICghY1tzXSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKFwiY2xpY2tcIiA9PSBkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGgoYi50YXJnZXQpLmlzKFwiYVwiKSlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIEYoYSwgITEsICEwKVxuICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgeSAmJiAoL3V0fG5kLy50ZXN0KGQpID8gKGdbel0oQiksIGVbel0oQykpIDogKGdbdl0oQiksIGVbdl0oQykpKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChKKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGIuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBlbHNlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuITFcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgYS5vbihcImNsaWNrLmkgZm9jdXMuaSBibHVyLmkga2V5dXAuaSBrZXlkb3duLmkga2V5cHJlc3MuaVwiLCBmdW5jdGlvbihiKSB7XG4gICAgICAgICAgICAgICAgdmFyIGQgPSBiW25dO1xuICAgICAgICAgICAgICAgIGIgPSBiLmtleUNvZGU7XG4gICAgICAgICAgICAgICAgaWYgKFwiY2xpY2tcIiA9PSBkKVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4hMTtcbiAgICAgICAgICAgICAgICBpZiAoXCJrZXlkb3duXCIgPT0gZCAmJiAzMiA9PSBiKVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gY1tuXSA9PSB1ICYmIGNbbF0gfHwgKGNbbF0gPyB0KGEsIGwpIDogRChhLCBsKSksICExO1xuICAgICAgICAgICAgICAgIGlmIChcImtleXVwXCIgPT0gZCAmJiBjW25dID09IHUpXG4gICAgICAgICAgICAgICAgICAgICFjW2xdICYmIEQoYSwgbCk7XG4gICAgICAgICAgICAgICAgZWxzZSBpZiAoL3VzfHVyLy50ZXN0KGQpKVxuICAgICAgICAgICAgICAgICAgICBnW1wiYmx1clwiID09XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZCA/IHogOiB2XSh4KVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBkLm9uKFwiY2xpY2sgbW91c2Vkb3duIG1vdXNldXAgbW91c2VvdmVyIG1vdXNlb3V0IHRvdWNoYmVnaW4uaSB0b3VjaGVuZC5pXCIsIGZ1bmN0aW9uKGIpIHtcbiAgICAgICAgICAgICAgICB2YXIgZCA9IGJbbl0sIGUgPSAvd258dXAvLnRlc3QoZCkgPyB3IDogQjtcbiAgICAgICAgICAgICAgICBpZiAoIWNbc10pIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKFwiY2xpY2tcIiA9PSBkKVxuICAgICAgICAgICAgICAgICAgICAgICAgRihhLCAhMSwgITApO1xuICAgICAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICgvd258ZXJ8aW4vLnRlc3QoZCkpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZ1t2XShlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGVsc2VcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBnW3pdKGUgKyBcIiBcIiArIHcpO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKG0ubGVuZ3RoICYmIHkgJiYgZSA9PSBCKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1bL3V0fG5kLy50ZXN0KGQpID8geiA6IHZdKEMpXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgaWYgKEopXG4gICAgICAgICAgICAgICAgICAgICAgICBiLnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgICAgICAgICAgICAgICBlbHNlXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4hMVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0pXG4gICAgfVxufSkod2luZG93LmpRdWVyeSB8fCB3aW5kb3cuWmVwdG8pO1xufSkuY2FsbCh0aGlzLHJlcXVpcmUoXCIrN1pKcDBcIiksdHlwZW9mIHNlbGYgIT09IFwidW5kZWZpbmVkXCIgPyBzZWxmIDogdHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiA/IHdpbmRvdyA6IHt9LHJlcXVpcmUoXCJidWZmZXJcIikuQnVmZmVyLGFyZ3VtZW50c1szXSxhcmd1bWVudHNbNF0sYXJndW1lbnRzWzVdLGFyZ3VtZW50c1s2XSxcIi9BZG1pbkxURS9hcHAuanNcIixcIi9BZG1pbkxURVwiKSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbi8qXG4gKiBBdXRob3I6IEFiZHVsbGFoIEEgQWxtc2FlZWRcbiAqIERhdGU6IDQgSmFuIDIwMTRcbiAqIERlc2NyaXB0aW9uOlxuICogICAgICBUaGlzIGlzIGEgZGVtbyBmaWxlIHVzZWQgb25seSBmb3IgdGhlIG1haW4gZGFzaGJvYXJkIChpbmRleC5odG1sKVxuICoqL1xuXG4kKGZ1bmN0aW9uKCkge1xuICAgIFwidXNlIHN0cmljdFwiO1xuXG5cbn0pO1xufSkuY2FsbCh0aGlzLHJlcXVpcmUoXCIrN1pKcDBcIiksdHlwZW9mIHNlbGYgIT09IFwidW5kZWZpbmVkXCIgPyBzZWxmIDogdHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiA/IHdpbmRvdyA6IHt9LHJlcXVpcmUoXCJidWZmZXJcIikuQnVmZmVyLGFyZ3VtZW50c1szXSxhcmd1bWVudHNbNF0sYXJndW1lbnRzWzVdLGFyZ3VtZW50c1s2XSxcIi9BZG1pbkxURS9kYXNoYm9hcmQuanNcIixcIi9BZG1pbkxURVwiKSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbiQoZnVuY3Rpb24oKSB7XG4gICAgLyogRm9yIGRlbW8gcHVycG9zZXMgKi9cbiAgICB2YXIgZGVtbyA9ICQoXCI8ZGl2IC8+XCIpLmNzcyh7XG4gICAgICAgIHBvc2l0aW9uOiBcImZpeGVkXCIsXG4gICAgICAgIHRvcDogXCIxNTBweFwiLFxuICAgICAgICByaWdodDogXCIwXCIsXG4gICAgICAgIGJhY2tncm91bmQ6IFwicmdiYSgwLCAwLCAwLCAwLjcpXCIsXG4gICAgICAgIFwiYm9yZGVyLXJhZGl1c1wiOiBcIjVweCAwcHggMHB4IDVweFwiLFxuICAgICAgICBwYWRkaW5nOiBcIjEwcHggMTVweFwiLFxuICAgICAgICBcImZvbnQtc2l6ZVwiOiBcIjE2cHhcIixcbiAgICAgICAgXCJ6LWluZGV4XCI6IFwiOTk5OTk5XCIsXG4gICAgICAgIGN1cnNvcjogXCJwb2ludGVyXCIsXG4gICAgICAgIGNvbG9yOiBcIiNkZGRcIlxuICAgIH0pLmh0bWwoXCI8aSBjbGFzcz0nZmEgZmEtZ2Vhcic+PC9pPlwiKS5hZGRDbGFzcyhcIm5vLXByaW50XCIpO1xuXG4gICAgdmFyIGRlbW9fc2V0dGluZ3MgPSAkKFwiPGRpdiAvPlwiKS5jc3Moe1xuICAgICAgICBcInBhZGRpbmdcIjogXCIxMHB4XCIsXG4gICAgICAgIHBvc2l0aW9uOiBcImZpeGVkXCIsXG4gICAgICAgIHRvcDogXCIxMzBweFwiLFxuICAgICAgICByaWdodDogXCItMjAwcHhcIixcbiAgICAgICAgYmFja2dyb3VuZDogXCIjZmZmXCIsXG4gICAgICAgIGJvcmRlcjogXCIzcHggc29saWQgcmdiYSgwLCAwLCAwLCAwLjcpXCIsXG4gICAgICAgIFwid2lkdGhcIjogXCIyMDBweFwiLFxuICAgICAgICBcInotaW5kZXhcIjogXCI5OTk5OTlcIlxuICAgIH0pLmFkZENsYXNzKFwibm8tcHJpbnRcIik7XG4gICAgZGVtb19zZXR0aW5ncy5hcHBlbmQoXG4gICAgICAgICAgICBcIjxoNCBzdHlsZT0nbWFyZ2luOiAwIDAgNXB4IDA7IGJvcmRlci1ib3R0b206IDFweCBkYXNoZWQgI2RkZDsgcGFkZGluZy1ib3R0b206IDNweDsnPkxheW91dCBPcHRpb25zPC9oND5cIlxuICAgICAgICAgICAgKyBcIjxkaXYgY2xhc3M9J2Zvcm0tZ3JvdXAgbm8tbWFyZ2luJz5cIlxuICAgICAgICAgICAgKyBcIjxkaXYgY2xhc3M9Jy5jaGVja2JveCc+XCJcbiAgICAgICAgICAgICsgXCI8bGFiZWw+XCJcbiAgICAgICAgICAgICsgXCI8aW5wdXQgdHlwZT0nY2hlY2tib3gnIG9uY2hhbmdlPSdjaGFuZ2VfbGF5b3V0KCk7Jy8+IFwiXG4gICAgICAgICAgICArIFwiRml4ZWQgbGF5b3V0XCJcbiAgICAgICAgICAgICsgXCI8L2xhYmVsPlwiXG4gICAgICAgICAgICArIFwiPC9kaXY+XCJcbiAgICAgICAgICAgICsgXCI8L2Rpdj5cIlxuICAgICAgICAgICAgKTtcbiAgICBkZW1vX3NldHRpbmdzLmFwcGVuZChcbiAgICAgICAgICAgIFwiPGg0IHN0eWxlPSdtYXJnaW46IDAgMCA1cHggMDsgYm9yZGVyLWJvdHRvbTogMXB4IGRhc2hlZCAjZGRkOyBwYWRkaW5nLWJvdHRvbTogM3B4Oyc+U2tpbnM8L2g0PlwiXG4gICAgICAgICAgICArIFwiPGRpdiBjbGFzcz0nZm9ybS1ncm91cCBuby1tYXJnaW4nPlwiXG4gICAgICAgICAgICArIFwiPGRpdiBjbGFzcz0nLnJhZGlvJz5cIlxuICAgICAgICAgICAgKyBcIjxsYWJlbD5cIlxuICAgICAgICAgICAgKyBcIjxpbnB1dCBuYW1lPSdza2lucycgdHlwZT0ncmFkaW8nIG9uY2hhbmdlPSdjaGFuZ2Vfc2tpbihcXFwic2tpbi1ibGFja1xcXCIpOycgLz4gXCJcbiAgICAgICAgICAgICsgXCJCbGFja1wiXG4gICAgICAgICAgICArIFwiPC9sYWJlbD5cIlxuICAgICAgICAgICAgKyBcIjwvZGl2PlwiXG4gICAgICAgICAgICArIFwiPC9kaXY+XCJcblxuICAgICAgICAgICAgKyBcIjxkaXYgY2xhc3M9J2Zvcm0tZ3JvdXAgbm8tbWFyZ2luJz5cIlxuICAgICAgICAgICAgKyBcIjxkaXYgY2xhc3M9Jy5yYWRpbyc+XCJcbiAgICAgICAgICAgICsgXCI8bGFiZWw+XCJcbiAgICAgICAgICAgICsgXCI8aW5wdXQgbmFtZT0nc2tpbnMnIHR5cGU9J3JhZGlvJyBvbmNoYW5nZT0nY2hhbmdlX3NraW4oXFxcInNraW4tYmx1ZVxcXCIpOycgY2hlY2tlZD0nY2hlY2tlZCcvPiBcIlxuICAgICAgICAgICAgKyBcIkJsdWVcIlxuICAgICAgICAgICAgKyBcIjwvbGFiZWw+XCJcbiAgICAgICAgICAgICsgXCI8L2Rpdj5cIlxuICAgICAgICAgICAgKyBcIjwvZGl2PlwiXG4gICAgICAgICAgICApO1xuXG4gICAgZGVtby5jbGljayhmdW5jdGlvbigpIHtcbiAgICAgICAgaWYgKCEkKHRoaXMpLmhhc0NsYXNzKFwib3BlblwiKSkge1xuICAgICAgICAgICAgJCh0aGlzKS5jc3MoXCJyaWdodFwiLCBcIjIwMHB4XCIpO1xuICAgICAgICAgICAgZGVtb19zZXR0aW5ncy5jc3MoXCJyaWdodFwiLCBcIjBcIik7XG4gICAgICAgICAgICAkKHRoaXMpLmFkZENsYXNzKFwib3BlblwiKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICQodGhpcykuY3NzKFwicmlnaHRcIiwgXCIwXCIpO1xuICAgICAgICAgICAgZGVtb19zZXR0aW5ncy5jc3MoXCJyaWdodFwiLCBcIi0yMDBweFwiKTtcbiAgICAgICAgICAgICQodGhpcykucmVtb3ZlQ2xhc3MoXCJvcGVuXCIpXG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgICQoXCJib2R5XCIpLmFwcGVuZChkZW1vKTtcbiAgICAkKFwiYm9keVwiKS5hcHBlbmQoZGVtb19zZXR0aW5ncyk7XG59KTtcbn0pLmNhbGwodGhpcyxyZXF1aXJlKFwiKzdaSnAwXCIpLHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvQWRtaW5MVEUvZGVtby5qc1wiLFwiL0FkbWluTFRFXCIpIiwiKGZ1bmN0aW9uIChwcm9jZXNzLGdsb2JhbCxCdWZmZXIsX19hcmd1bWVudDAsX19hcmd1bWVudDEsX19hcmd1bWVudDIsX19hcmd1bWVudDMsX19maWxlbmFtZSxfX2Rpcm5hbWUpe1xucmVxdWlyZSgnLi9BZG1pbkxURS9hcHAnKTtcbnJlcXVpcmUoJy4vQWRtaW5MVEUvZGFzaGJvYXJkJyk7XG5yZXF1aXJlKCcuL0FkbWluTFRFL2RlbW8nKTtcblxucmVxdWlyZSgnLi4vY29udHJvbGxlcnMvX21vZHVsZV9pbml0Jyk7XG5yZXF1aXJlKCcuLi9zZXJ2aWNlcy9fbW9kdWxlX2luaXQnKTtcbnJlcXVpcmUoJy4uL2RpcmVjdGl2ZXMvX21vZHVsZV9pbml0Jyk7XG5yZXF1aXJlKCcuLi9jb25maWcvX21vZHVsZV9pbml0Jyk7XG5yZXF1aXJlKCcuLi9jb250cm9scy9fbW9kdWxlX2luaXQnKTtcblxuYW5ndWxhci5lbGVtZW50KGRvY3VtZW50KS5yZWFkeShmdW5jdGlvbigpIHtcblxuXHR2YXIgcmVxdWlyZXMgPSBbXG5cdFx0J3VpLnJvdXRlcicsXG5cdFx0J25nUmVzb3VyY2UnLFxuXHRcdCdhcHAuY29uZmlnJyxcblx0XHQnYXBwLmNvbnRyb2xsZXJzJyxcblx0XHQnYXBwLnNlcnZpY2VzJyxcblx0XHQnYXBwLmRpcmVjdGl2ZXMnLFxuXHRcdCdhcHAuY29udHJvbHMnLFxuXHRdO1xuXG5cdHZhciBhcHAgPSBhbmd1bGFyLm1vZHVsZSgnYXBwJywgcmVxdWlyZXMpO1xuXG5cdGFwcC5jb25maWcoWyckaHR0cFByb3ZpZGVyJywgJyRzY2VEZWxlZ2F0ZVByb3ZpZGVyJyxcblx0XHRmdW5jdGlvbigkaHR0cFByb3ZpZGVyLCAkc2NlRGVsZWdhdGVQcm92aWRlcikge1xuXHRcdFx0JGh0dHBQcm92aWRlci5kZWZhdWx0cy51c2VYRG9tYWluID0gdHJ1ZTtcblx0XHRcdCRzY2VEZWxlZ2F0ZVByb3ZpZGVyLnJlc291cmNlVXJsV2hpdGVsaXN0KFsnc2VsZicsIC9eaHR0cHM/OlxcL1xcLyhjZG5cXC4pP3F1YWRyYW1tYS5jb20vXSk7XG5cdFx0XHRkZWxldGUgJGh0dHBQcm92aWRlci5kZWZhdWx0cy5oZWFkZXJzLmNvbW1vblsnWC1SZXF1ZXN0ZWQtV2l0aCddO1xuXHRcdH1cblx0XSk7XG5cblx0YXBwLnJ1bihbXG5cdFx0JyRRSkNvbmZpZycsXG5cdFx0ZnVuY3Rpb24oJFFKQ29uZmlnKSB7XG5cdFx0XHQvL3N0b3JlLmNsZWFyKCk7XG5cdFx0XHQkUUpDb25maWcuY29uZmlndXJlKCk7XG5cdFx0fVxuXHRdKTtcblxuXG5cdGFuZ3VsYXIuYm9vdHN0cmFwKGRvY3VtZW50LCBbJ2FwcCddKTtcblxufSk7XG59KS5jYWxsKHRoaXMscmVxdWlyZShcIis3WkpwMFwiKSx0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30scmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIsYXJndW1lbnRzWzNdLGFyZ3VtZW50c1s0XSxhcmd1bWVudHNbNV0sYXJndW1lbnRzWzZdLFwiL2Zha2VfYWVhMzgxZC5qc1wiLFwiL1wiKSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbm1vZHVsZS5leHBvcnRzID0gYW5ndWxhci5tb2R1bGUoJ2FwcC5zZXJ2aWNlcycsIFtdKTtcbnJlcXVpcmUoJy4vYXBpU2VydmljZS5qcycpO1xucmVxdWlyZSgnLi9hdXRoU2VydmljZS5qcycpO1xucmVxdWlyZSgnLi9jb25maWdTZXJ2aWNlLmpzJyk7XG5yZXF1aXJlKCcuL2Vycm9ySGFuZGxlclNlcnZpY2UuanMnKTtcbnJlcXVpcmUoJy4vaGVscGVyU2VydmljZS5qcycpXG5yZXF1aXJlKCcuL2xvY2FsU2Vzc2lvblNlcnZpY2UuanMnKTtcbnJlcXVpcmUoJy4vbG9nZ2VyU2VydmljZS5qcycpO1xucmVxdWlyZSgnLi9sb2dpblNlcnZpY2UuanMnKTtcbn0pLmNhbGwodGhpcyxyZXF1aXJlKFwiKzdaSnAwXCIpLHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvLi4vc2VydmljZXMvX21vZHVsZV9pbml0LmpzXCIsXCIvLi4vc2VydmljZXNcIikiLCIoZnVuY3Rpb24gKHByb2Nlc3MsZ2xvYmFsLEJ1ZmZlcixfX2FyZ3VtZW50MCxfX2FyZ3VtZW50MSxfX2FyZ3VtZW50MixfX2FyZ3VtZW50MyxfX2ZpbGVuYW1lLF9fZGlybmFtZSl7XG52YXIgbW9kdWxlID0gcmVxdWlyZSgnLi9fbW9kdWxlX2luaXQuanMnKTtcbm1vZHVsZS5mYWN0b3J5KCckUUpBcGknLCBbJyRRSkxvZ2dlcicsIFwiJFFKQ29uZmlnXCIsIFwiJHJlc291cmNlXCIsICckUUpFcnJvckhhbmRsZXInLCAnJHJvb3RTY29wZScsXG5cdGZ1bmN0aW9uKCRRSkxvZ2dlciwgJFFKQ29uZmlnLCAkcmVzb3VyY2UsICRRSkVycm9ySGFuZGxlciwgJHJvb3RTY29wZSkge1xuXHRcdHZhciBydGEgPSBuZXcoZnVuY3Rpb24oKSB7XG5cblx0XHRcdC8vYXBpIGluIHJvb3Rcblx0XHRcdGlmIChfLmlzVW5kZWZpbmVkKCRyb290U2NvcGUuYXBpKSkge1xuXHRcdFx0XHR2YXIgX2FwaUluZm8gPSB7XG5cdFx0XHRcdFx0c3RhdHVzOiAnV2FpdGluZycsXG5cdFx0XHRcdFx0Y2FsbHM6IFtdLFxuXHRcdFx0XHRcdGNhbGxzX3dvcmtpbmc6IDAsXG5cdFx0XHRcdFx0Y2FsbHNfZmluaXNoZWQ6IDAsXG5cdFx0XHRcdFx0Y2FsbHNJblByb2dyZXNzOiBmdW5jdGlvbigpIHtcblx0XHRcdFx0XHRcdHZhciBhc2QgPSAoXy5maWx0ZXIoX2FwaUluZm8uY2FsbHMsIGZ1bmN0aW9uKGNhbGwpIHtcblx0XHRcdFx0XHRcdFx0cmV0dXJuIGNhbGwuZW5kZWQgPSB0cnVlO1xuXHRcdFx0XHRcdFx0fSkpLmxlbmd0aCgpO1xuXG5cdFx0XHRcdFx0XHRyZXR1cm4gMDtcblx0XHRcdFx0XHR9LFxuXHRcdFx0XHRcdHN0YXJ0OiBmdW5jdGlvbihpbmZvKSB7XG5cdFx0XHRcdFx0XHR2YXIgY2FsbCA9IHtcblx0XHRcdFx0XHRcdFx0aW5mbzogaW5mbyxcblx0XHRcdFx0XHRcdFx0ZW5kZWQ6IGZhbHNlLFxuXHRcdFx0XHRcdFx0XHRzdGFydFRpbWU6IChuZXcgRGF0ZSgpKS5nZXRUaW1lKCksXG5cdFx0XHRcdFx0XHRcdGVuZFRpbWU6IG51bGwsXG5cdFx0XHRcdFx0XHRcdGR1cmF0aW9uOiBudWxsXG5cdFx0XHRcdFx0XHR9O1xuXHRcdFx0XHRcdFx0X2FwaUluZm8uY2FsbHNfd29ya2luZyArPSAxO1xuXHRcdFx0XHRcdFx0X2FwaUluZm8uc3RhdHVzID0gJ1dvcmtpbmcnO1xuXHRcdFx0XHRcdFx0X2FwaUluZm8uY2FsbHMucHVzaChjYWxsKTtcblx0XHRcdFx0XHRcdHJldHVybiB7IC8vcmVwcmVzZW50cyB0aGUgY2FsbFxuXHRcdFx0XHRcdFx0XHRlbmQ6IGZ1bmN0aW9uKCkge1xuXHRcdFx0XHRcdFx0XHRcdGNhbGwuZW5kZWQgPSB0cnVlO1xuXHRcdFx0XHRcdFx0XHRcdGNhbGwuZW5kVGltZSA9IChuZXcgRGF0ZSgpKS5nZXRUaW1lKCk7XG5cdFx0XHRcdFx0XHRcdFx0Y2FsbC5kdXJhdGlvbiA9IChjYWxsLnN0YXJ0VGltZSAtIGNhbGwuZW5kVGltZSkgLyAxMDA7IC8vZHVyIGluIHNlY3MuXG5cdFx0XHRcdFx0XHRcdFx0X2FwaUluZm8uY2FsbHNfd29ya2luZyAtPSAxO1xuXHRcdFx0XHRcdFx0XHRcdF9hcGlJbmZvLmNhbGxzX2ZpbmlzaGVkICs9IDE7XG5cdFx0XHRcdFx0XHRcdFx0aWYgKF9hcGlJbmZvLmNhbGxzX3dvcmtpbmcgPT0gMCkge1xuXHRcdFx0XHRcdFx0XHRcdFx0X2FwaUluZm8uc3RhdHVzID0gJ1dhaXRpbmcnO1xuXHRcdFx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0fTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdH07XG5cblx0XHRcdFx0dmFyIGNhbGwgPSBfYXBpSW5mby5zdGFydCh7XG5cdFx0XHRcdFx0ZGVzY3JpcHRpb246ICdUZXN0IHRhc2sgZm9yIGFwaSdcblx0XHRcdFx0fSk7XG5cdFx0XHRcdGNhbGwuZW5kKCk7XG5cblxuXHRcdFx0XHQkcm9vdFNjb3BlLmFwaSA9IF9hcGlJbmZvO1xuXHRcdFx0XHRnYXBpID0gJHJvb3RTY29wZS5hcGk7XG5cdFx0XHR9XG5cblxuXG5cdFx0XHQvLy0tQ0xBU1MgREVGXG5cdFx0XHR2YXIgc2VsZiA9IHRoaXM7XG5cblx0XHRcdC8vUFJJVkFURUVcblx0XHRcdGZ1bmN0aW9uIGhhc1JlcG9ydGVkRXJyb3JzKHJlcywgaWdub3JlQmFkUmVxdWVzdCkge1xuXHRcdFx0XHRpZiAocmVzICYmIF8uaXNVbmRlZmluZWQocmVzLm9rKSkge1xuXHRcdFx0XHRcdC8vY29uc29sZS5sb2cocmVzKTtcblx0XHRcdFx0XHQkUUpFcnJvckhhbmRsZXIuaGFuZGxlKCRRSkVycm9ySGFuZGxlci5jb2Rlcy5BUElfSU5WQUxJRF9SRVNQT05TRSwgcmVzKTtcblx0XHRcdFx0XHRyZXR1cm4gdHJ1ZTtcblx0XHRcdFx0fVxuXHRcdFx0XHRpZiAocmVzICYmICFfLmlzVW5kZWZpbmVkKHJlcy5vaykgJiYgcmVzLm9rID09IGZhbHNlICYmICFpZ25vcmVCYWRSZXF1ZXN0KSB7XG5cblx0XHRcdFx0XHRpZiAocmVzICYmICFfLmlzVW5kZWZpbmVkKHJlcy5lcnJvcmNvZGUpKSB7XG5cdFx0XHRcdFx0XHQkUUpMb2dnZXIubG9nKCdhcGkgd2FybmluZyAtPiBoYW5kbGluZyBlcnJvcmNvZGUgJyArIHJlcy5lcnJvcmNvZGUpO1xuXHRcdFx0XHRcdFx0JFFKRXJyb3JIYW5kbGVyLmhhbmRsZShyZXMuZXJyb3Jjb2RlLCByZXMpO1xuXHRcdFx0XHRcdFx0cmV0dXJuIHRydWU7XG5cdFx0XHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0XHRcdCRRSkVycm9ySGFuZGxlci5oYW5kbGUoJFFKRXJyb3JIYW5kbGVyLkFQSV9SRVNQT05TRV9IQVNfRVJST1JTX1dJVEhPVVRfRVJST1JDT0RFLCByZXMpO1xuXHRcdFx0XHRcdFx0cmV0dXJuIHRydWU7XG5cdFx0XHRcdFx0fVxuXG5cdFx0XHRcdFx0JFFKRXJyb3JIYW5kbGVyLmhhbmRsZSgkUUpFcnJvckhhbmRsZXIuY29kZXMuQVBJX1JFU1BPTlNFX0hBU19FUlJPUlMsIHJlcyk7XG5cdFx0XHRcdFx0cmV0dXJuIHRydWU7XG5cdFx0XHRcdH1cblx0XHRcdFx0cmV0dXJuIGZhbHNlO1xuXHRcdFx0fVxuXG5cdFx0XHRmdW5jdGlvbiBnZXRDb250cm9sbGVyKGNvbnRyb2xsZXJOYW1lLCBpZ25vcmVCYWRSZXF1ZXN0KSB7XG5cdFx0XHRcdHZhciAkcmVzID0gJHJlc291cmNlKCRyb290U2NvcGUuY29uZmlnLmFwaSArICcvOmNvbnRyb2xsZXIvOmFjdGlvbi86aWQnLCB7fSwge1xuXHRcdFx0XHRcdHF1ZXJ5OiB7XG5cdFx0XHRcdFx0XHRtZXRob2Q6IFwiR0VUXCIsXG5cdFx0XHRcdFx0XHRpc0FycmF5OiB0cnVlXG5cdFx0XHRcdFx0fSxcblx0XHRcdFx0XHRnZXQ6IHtcblx0XHRcdFx0XHRcdG1ldGhvZDogXCJHRVRcIixcblx0XHRcdFx0XHRcdGlzQXJyYXk6IGZhbHNlLFxuXHRcdFx0XHRcdFx0cGFyYW1zOiB7XG5cdFx0XHRcdFx0XHRcdGNvbnRyb2xsZXI6IGNvbnRyb2xsZXJOYW1lXG5cdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0fSxcblx0XHRcdFx0XHRyZXF1ZXN0OiB7XG5cdFx0XHRcdFx0XHRtZXRob2Q6ICdQT1NUJyxcblx0XHRcdFx0XHRcdGlzQXJyYXk6IGZhbHNlLFxuXHRcdFx0XHRcdFx0cGFyYW1zOiB7XG5cdFx0XHRcdFx0XHRcdGNvbnRyb2xsZXI6IGNvbnRyb2xsZXJOYW1lXG5cdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0fSxcblx0XHRcdFx0XHRzYXZlOiB7XG5cdFx0XHRcdFx0XHRtZXRob2Q6ICdQT1NUJyxcblx0XHRcdFx0XHRcdGlzQXJyYXk6IGZhbHNlXG5cdFx0XHRcdFx0fSxcblx0XHRcdFx0XHR1cGRhdGU6IHtcblx0XHRcdFx0XHRcdG1ldGhvZDogJ1BPU1QnLFxuXHRcdFx0XHRcdFx0aXNBcnJheTogZmFsc2Vcblx0XHRcdFx0XHR9LFxuXHRcdFx0XHRcdGRlbGV0ZToge1xuXHRcdFx0XHRcdFx0bWV0aG9kOiBcIkRFTEVURVwiLFxuXHRcdFx0XHRcdFx0aXNBcnJheTogZmFsc2Vcblx0XHRcdFx0XHR9XG5cdFx0XHRcdH0pO1xuXHRcdFx0XHR2YXIgY29udHJvbGxlciA9IHt9O1xuXHRcdFx0XHRjb250cm9sbGVyLmhhc1JlcG9ydGVkRXJyb3JzID0gaGFzUmVwb3J0ZWRFcnJvcnM7XG5cdFx0XHRcdGNvbnRyb2xsZXIucG9zdCA9IGZ1bmN0aW9uKHBhcmFtcywgcG9zdERhdGEsIHN1Y2Nlc3MpIHtcblx0XHRcdFx0XHR2YXIgY2FsbCA9ICRyb290U2NvcGUuYXBpLnN0YXJ0KHBhcmFtcyk7XG5cdFx0XHRcdFx0JHJlcy5yZXF1ZXN0KHBhcmFtcywgcG9zdERhdGEsIGZ1bmN0aW9uKHJlcykge1xuXHRcdFx0XHRcdFx0Y2FsbC5lbmQoKTtcblx0XHRcdFx0XHRcdGlmICghaGFzUmVwb3J0ZWRFcnJvcnMocmVzLCBpZ25vcmVCYWRSZXF1ZXN0KSkge1xuXHRcdFx0XHRcdFx0XHRzdWNjZXNzKHJlcyk7XG5cdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0fSwgZnVuY3Rpb24oKSB7XG5cdFx0XHRcdFx0XHRjYWxsLmVuZCgpO1xuXHRcdFx0XHRcdFx0JFFKRXJyb3JIYW5kbGVyLmhhbmRsZSgkUUpFcnJvckhhbmRsZXIuY29kZXMuQVBJX0VSUk9SKTtcblx0XHRcdFx0XHR9KTtcblx0XHRcdFx0fVxuXHRcdFx0XHRjb250cm9sbGVyLmdldCA9IGZ1bmN0aW9uKHBhcmFtcywgc3VjY2Vzcykge1xuXHRcdFx0XHRcdHZhciBjYWxsID0gJHJvb3RTY29wZS5hcGkuc3RhcnQocGFyYW1zKTtcblx0XHRcdFx0XHQkcmVzLmdldChwYXJhbXMsIGZ1bmN0aW9uKHJlcykge1xuXHRcdFx0XHRcdFx0Y2FsbC5lbmQoKTtcblx0XHRcdFx0XHRcdGlmICghaGFzUmVwb3J0ZWRFcnJvcnMocmVzLCBpZ25vcmVCYWRSZXF1ZXN0KSkge1xuXHRcdFx0XHRcdFx0XHRzdWNjZXNzKHJlcyk7XG5cdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0fSwgZnVuY3Rpb24ocmVzKSB7XG5cdFx0XHRcdFx0XHRjYWxsLmVuZCgpO1xuXHRcdFx0XHRcdFx0aWYgKHJlcyAmJiAhXy5pc1VuZGVmaW5lZChyZXMuc3RhdHVzKSAmJiByZXMuc3RhdHVzID09IDUwMCkge1xuXHRcdFx0XHRcdFx0XHQkUUpFcnJvckhhbmRsZXIuaGFuZGxlKCRRSkVycm9ySGFuZGxlci5jb2Rlcy5BUElfSU5URVJOQUxfU0VSVkVSX0VSUk9SKTtcblx0XHRcdFx0XHRcdFx0cmV0dXJuO1xuXHRcdFx0XHRcdFx0fVxuXG5cdFx0XHRcdFx0XHQkUUpFcnJvckhhbmRsZXIuaGFuZGxlKCRRSkVycm9ySGFuZGxlci5jb2Rlcy5BUElfRVJST1IpO1xuXHRcdFx0XHRcdH0pO1xuXHRcdFx0XHR9O1xuXG5cdFx0XHRcdHJldHVybiBjb250cm9sbGVyO1xuXHRcdFx0fVxuXG5cdFx0XHQvL1BVQkxJQyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXHRcdFx0c2VsZi5nZXRDb250cm9sbGVyID0gZnVuY3Rpb24oY29udHJvbGxlck5hbWUpIHtcblx0XHRcdFx0cmV0dXJuIGdldENvbnRyb2xsZXIoY29udHJvbGxlck5hbWUsIGZhbHNlKTtcblx0XHRcdH07XG5cdFx0XHRzZWxmLmdldExvZ2luQ29udHJvbGxlciA9IGZ1bmN0aW9uKGNvbnRyb2xsZXJOYW1lKSB7XG5cdFx0XHRcdGNvbnNvbGUuaW5mbyhcImxvZ2luIGNvbnRyb2xsZXIgcmV0dXJuXCIpO1xuXHRcdFx0XHRyZXR1cm4gZ2V0Q29udHJvbGxlcihjb250cm9sbGVyTmFtZSwgdHJ1ZSk7XG5cdFx0XHR9O1xuXHRcdFx0c2VsZi5pc09LID0gZnVuY3Rpb24oc3VjY2VzcywgZmFpbHVyZSkge1xuXHRcdFx0XHQvL0NoZWNrIGFwaSBzdGF0dXNcblx0XHRcdFx0dmFyIFRlc3QgPSBzZWxmLmdldENvbnRyb2xsZXIoXCJ0ZXN0XCIpO1xuXHRcdFx0XHRUZXN0LmdldCh7XG5cdFx0XHRcdFx0YWN0aW9uOiBcInN0YXR1c1wiXG5cdFx0XHRcdH0sIGZ1bmN0aW9uKHJlcykge1xuXHRcdFx0XHRcdGlmIChyZXMgJiYgIV8uaXNVbmRlZmluZWQocmVzLm9rKSAmJiByZXMub2sgPT0gdHJ1ZSkge1xuXHRcdFx0XHRcdFx0c3VjY2VzcygpO1xuXHRcdFx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdFx0XHRmYWlsdXJlKCk7XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHR9KVxuXHRcdFx0fTtcblx0XHRcdHJldHVybiBzZWxmO1xuXHRcdFx0Ly8tLUNMQVNTIERFRlxuXHRcdH0pKCk7XG5cdFx0cmV0dXJuIHJ0YTsgLy9mYWN0b3J5IHJldHVyblxuXHR9XG5dKTtcbn0pLmNhbGwodGhpcyxyZXF1aXJlKFwiKzdaSnAwXCIpLHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvLi4vc2VydmljZXMvYXBpU2VydmljZS5qc1wiLFwiLy4uL3NlcnZpY2VzXCIpIiwiKGZ1bmN0aW9uIChwcm9jZXNzLGdsb2JhbCxCdWZmZXIsX19hcmd1bWVudDAsX19hcmd1bWVudDEsX19hcmd1bWVudDIsX19hcmd1bWVudDMsX19maWxlbmFtZSxfX2Rpcm5hbWUpe1xudmFyIG1vZHVsZSA9IHJlcXVpcmUoJy4vX21vZHVsZV9pbml0LmpzJyk7XG5tb2R1bGUuZmFjdG9yeSgnJFFKQXV0aCcsIFsnJFFKTG9nZ2VyJywgXCIkcm9vdFNjb3BlXCIsIFwiJGh0dHBcIiwgJyRRSkxvY2FsU2Vzc2lvbicsXG5cdGZ1bmN0aW9uKCRRSkxvZ2dlciwgJHJvb3RTY29wZSwgJGh0dHAsICRRSkxvY2FsU2Vzc2lvbikge1xuXHRcdHJldHVybiB7XG5cdFx0XHR1cGRhdGVTZXNzaW9uQ3VzdG9tOiBmdW5jdGlvbih0b2tlbiwgX2dyb3VwX2lkKSB7XG5cdFx0XHRcdCRyb290U2NvcGUuc2Vzc2lvbi50b2tlbiA9IHRva2VuO1xuXHRcdFx0XHQkcm9vdFNjb3BlLnNlc3Npb24uX2dyb3VwX2lkID0gX2dyb3VwX2lkO1xuXHRcdFx0XHQkcm9vdFNjb3BlLmNvbmZpZy5fZ3JvdXBfaWQgPSBfZ3JvdXBfaWQ7XG5cdFx0XHRcdCRRSkxvY2FsU2Vzc2lvbi5zYXZlKCk7XG5cdFx0XHRcdCRyb290U2NvcGUuJGVtaXQoJ3Nlc3Npb24uY2hhbmdlJyk7XG5cdFx0XHRcdCRRSkxvZ2dlci5sb2coJ1FKQXV0aCAtPiB1cGRhdGVTZXNzaW9uQ3VzdG9tIC0+IHRva2VuIC0+JyArIHRva2VuKTtcblx0XHRcdH0sXG5cdFx0XHR1cGRhdGVTZXNzaW9uRnJvbUxvZ2luOiBmdW5jdGlvbihyZXMpIHtcblx0XHRcdFx0JHJvb3RTY29wZS5zZXNzaW9uLmxvZ2lubmFtZSA9IHJlcy5sb2dpbm5hbWU7XG5cdFx0XHRcdCRyb290U2NvcGUuc2Vzc2lvbi50b2tlbiA9IHJlcy50b2tlbjtcblx0XHRcdFx0JHJvb3RTY29wZS5zZXNzaW9uLnRva2VuUmVxID0gcmVzLnRva2VuUmVxO1xuXHRcdFx0XHQkcm9vdFNjb3BlLnNlc3Npb24udG9rZW5FeHAgPSByZXMudG9rZW5FeHA7XG5cdFx0XHRcdCRyb290U2NvcGUuc2Vzc2lvbi5fZ3JvdXBfaWQgPSAkcm9vdFNjb3BlLmNvbmZpZy5fZ3JvdXBfaWQ7XG5cdFx0XHRcdCRRSkxvY2FsU2Vzc2lvbi5zYXZlKCk7XG5cdFx0XHRcdCRyb290U2NvcGUuJGVtaXQoJ3Nlc3Npb24uY2hhbmdlJyk7XG5cdFx0XHRcdCRRSkxvZ2dlci5sb2coJ1FKQXV0aCAtPiB1cGRhdGVTZXNzaW9uRnJvbUxvZ2luIC0+IHRva2VuIC0+JyArIHJlcy50b2tlbik7XG5cblx0XHRcdH1cblx0XHR9XG5cdH1cbl0pO1xufSkuY2FsbCh0aGlzLHJlcXVpcmUoXCIrN1pKcDBcIiksdHlwZW9mIHNlbGYgIT09IFwidW5kZWZpbmVkXCIgPyBzZWxmIDogdHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiA/IHdpbmRvdyA6IHt9LHJlcXVpcmUoXCJidWZmZXJcIikuQnVmZmVyLGFyZ3VtZW50c1szXSxhcmd1bWVudHNbNF0sYXJndW1lbnRzWzVdLGFyZ3VtZW50c1s2XSxcIi8uLi9zZXJ2aWNlcy9hdXRoU2VydmljZS5qc1wiLFwiLy4uL3NlcnZpY2VzXCIpIiwiKGZ1bmN0aW9uIChwcm9jZXNzLGdsb2JhbCxCdWZmZXIsX19hcmd1bWVudDAsX19hcmd1bWVudDEsX19hcmd1bWVudDIsX19hcmd1bWVudDMsX19maWxlbmFtZSxfX2Rpcm5hbWUpe1xudmFyIG1vZHVsZSA9IHJlcXVpcmUoJy4vX21vZHVsZV9pbml0LmpzJyk7XG5tb2R1bGUuZmFjdG9yeSgnJFFKQ29uZmlnJywgWyckUUpMb2dnZXInLCAnJHJvb3RTY29wZScsICckc3RhdGUnLCAnJHRpbWVvdXQnLCAnJFFKTG9jYWxTZXNzaW9uJywgJyRRSkF1dGgnLFxuXHRmdW5jdGlvbigkUUpMb2dnZXIsICRyb290U2NvcGUsICRzdGF0ZSwgJHRpbWVvdXQsICRRSkxvY2FsU2Vzc2lvbiwgJFFKQXV0aCkge1xuXHRcdHZhciBzZWxmID0ge1xuXHRcdFx0YXBwTmFtZTogJ1FKJyxcblx0XHRcdEFwcElkZW50aWZpZXI6IFwiQXBwSWRlbnRpZmllcl9OQU1FXCIsXG5cdFx0XHQvL2FwaTogXCJodHRwOi8vbG9jYWxob3N0L3FqYXJ2aXMvYXBpXCIsIC8vU0lOICcvJyBBTCBGSU5BTFxuXHRcdFx0Ly9hcGk6IFwiaHR0cDovL3d3dy5xdWFkcmFtbWEuY29tL3BydWViYXMvcWphcnZpcy9hcGlcIiwgLy9TSU4gJy8nIEFMIEZJTkFMICBcblx0XHRcdGFwaTogKGxvY2F0aW9uLm9yaWdpbiArIGxvY2F0aW9uLnBhdGhuYW1lKS50b1N0cmluZygpLnJlcGxhY2UoXCJhZG1pblwiLCBcImFwaVwiKS5zdWJzdHJpbmcoMCwgKGxvY2F0aW9uLm9yaWdpbiArIGxvY2F0aW9uLnBhdGhuYW1lKS50b1N0cmluZygpLnJlcGxhY2UoXCJhZG1pblwiLCBcImFwaVwiKS5sZW5ndGggLSAxKSwgLy9BUEkgSU4gU0FNRSBQTEFDRSAoYWRtaW4sYXBpKSAvL1NJTiAnLycgQUwgRklOQUxcblx0XHRcdGZhY2Vib29rQXBwSUQ6IFwiODE1OTkxNzg1MDc4ODE5XCIsXG5cdFx0XHRfZ3JvdXBfaWQ6IDIsIC8vREVGQVVMVCBRSkFSVklTIEJBQ0tFTkQgKDIpXG5cdFx0XHRsaXN0dmlld0VudHJpZXNQZXJQYWdlOiA1LFxuXHRcdFx0aHRtbFRpdGxlOiBcIlFKYXJ2aXMgfCBEYXNoYm9hcmRcIlxuXHRcdH07XG5cdFx0cmV0dXJuIHtcblx0XHRcdGNvbmZpZ3VyZTogZnVuY3Rpb24oKSB7XG5cblxuXHRcdFx0XHQkLmdldEpTT04oXCJjb25maWcuanNvblwiLCBmdW5jdGlvbihkYXRhKSB7XG5cdFx0XHRcdFx0Y29uc29sZS5pbmZvKCdbQ09ORklHLkpTT05dW09LXScpO1xuXHRcdFx0XHRcdHNlbGYuYXBpID0gZGF0YS5hcGk7XG5cdFx0XHRcdH0pO1xuXG5cblx0XHRcdFx0JHJvb3RTY29wZS5jb25maWcgPSBzZWxmO1xuXHRcdFx0XHR2YXIgbG9jYWxzdG9yZVNlc3Npb25EYXRhID0gJFFKTG9jYWxTZXNzaW9uLmxvYWQoKTtcblx0XHRcdFx0c2Vzc2lvbiA9IGxvY2Fsc3RvcmVTZXNzaW9uRGF0YTtcblxuXHRcdFx0XHRpZiAoKHNlc3Npb24gJiYgc2Vzc2lvbi5fZ3JvdXBfaWQpKSB7XG5cdFx0XHRcdFx0c2Vzc2lvbi5jb25maWcgPSBzZWxmO1xuXHRcdFx0XHR9XG5cdFx0XHRcdC8vXG5cdFx0XHRcdHNlbGYuX2dyb3VwX2lkID0gKHNlc3Npb24gJiYgc2Vzc2lvbi5fZ3JvdXBfaWQpID8gc2Vzc2lvbi5fZ3JvdXBfaWQgOiBzZWxmLl9ncm91cF9pZDsgLy91cGRhdGVzIGNvbmZpZyB3aXRoIHNlc3Npb24gX2dyb3VwX2lkXG5cdFx0XHRcdGlmIChsb2NhbHN0b3JlU2Vzc2lvbkRhdGEpIHtcblx0XHRcdFx0XHQkcm9vdFNjb3BlLnNlc3Npb24gPSBsb2NhbHN0b3JlU2Vzc2lvbkRhdGE7XG5cdFx0XHRcdFx0JFFKTG9jYWxTZXNzaW9uLnNhdmUoKTtcblx0XHRcdFx0XHQkUUpMb2dnZXIubG9nKCdRSkNvbmZpZy0+IGNvbmZpZ3VyZS0+IHNlc3Npb24gaW5pdGlhbGl6ZWQgZnJvbSBsb2NhbHN0b3JlJyk7XG5cdFx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdFx0JFFKTG9nZ2VyLmxvZygnUUpDb25maWctPiBjb25maWd1cmUtPiBzZXNzaW9uIGluaXRpYWxpemVkIGZyb20gemVybycpO1xuXHRcdFx0XHRcdCRyb290U2NvcGUuc2Vzc2lvbiA9IHtcblx0XHRcdFx0XHRcdGxvZ2lubmFtZTogXCJcIixcblx0XHRcdFx0XHRcdHRva2VuOiBudWxsLFxuXHRcdFx0XHRcdFx0dG9rZW5SZXE6IG51bGwsXG5cdFx0XHRcdFx0XHR0b2tlbkV4cDogbnVsbCxcblx0XHRcdFx0XHR9O1xuXHRcdFx0XHR9XG5cdFx0XHRcdC8vXG5cdFx0XHRcdCRyb290U2NvcGUuaHRtbFRpdGxlID0gJHJvb3RTY29wZS5jb25maWcuaHRtbFRpdGxlO1xuXHRcdFx0XHQvL1xuXHRcdFx0XHQkUUpMb2dnZXIubG9nKCdRSkNvbmZpZy0+IGNvbmZpZ3VyZS0+IHN1Y2Nlc3MnKTtcblx0XHRcdFx0Ly9cblxuXG5cdFx0XHRcdGlmICghJHJvb3RTY29wZS5zZXNzaW9uIHx8ICgkcm9vdFNjb3BlLnNlc3Npb24gJiYgXy5pc1VuZGVmaW5lZCgkcm9vdFNjb3BlLnNlc3Npb24udG9rZW5FeHApKSkge1xuXHRcdFx0XHRcdCRRSkxvZ2dlci5sb2coJ1FKSGVscGVyIC0+IFRva2VuIC0+IG5vdCBhdmFsaWFibGUnKTtcblx0XHRcdFx0XHQkdGltZW91dChmdW5jdGlvbigpIHtcblx0XHRcdFx0XHRcdCRzdGF0ZS5nbygnbG9naW4nLCBudWxsKTtcblx0XHRcdFx0XHR9LCAwKTtcblx0XHRcdFx0XHRyZXR1cm47XG5cdFx0XHRcdH1cblx0XHRcdFx0aWYgKCRyb290U2NvcGUuc2Vzc2lvbiAmJiAkcm9vdFNjb3BlLnNlc3Npb24udG9rZW5FeHAgPT0gbnVsbCkge1xuXHRcdFx0XHRcdCRRSkxvZ2dlci5sb2coJ1FKSGVscGVyIC0+IFRva2VuIC0+IG5vdCBhdmFsaWFibGUnKTtcblx0XHRcdFx0XHQkdGltZW91dChmdW5jdGlvbigpIHtcblx0XHRcdFx0XHRcdCRzdGF0ZS5nbygnbG9naW4nLCBudWxsKTtcblx0XHRcdFx0XHR9LCAwKTtcblx0XHRcdFx0XHRyZXR1cm47XG5cdFx0XHRcdH1cblx0XHRcdFx0dmFyIG1pbGxpTm93ID0gbmV3IERhdGUoKS5nZXRUaW1lKCk7XG5cdFx0XHRcdHZhciBtaWxsaURpZmYgPSBtaWxsaU5vdyAtIHBhcnNlSW50KCRyb290U2NvcGUuc2Vzc2lvbi50b2tlbkV4cCk7XG5cdFx0XHRcdHZhciBleHBpcmF0aW9uU2Vjb25kcyA9IChNYXRoLmFicyhtaWxsaURpZmYpIC8gMTAwMCk7XG5cblx0XHRcdFx0aWYgKG1pbGxpRGlmZiA+IDApIHtcblx0XHRcdFx0XHQkdGltZW91dChmdW5jdGlvbigpIHtcblx0XHRcdFx0XHRcdCRzdGF0ZS5nbygnbG9naW4nLCBudWxsKTtcblx0XHRcdFx0XHR9LCAwKTtcblx0XHRcdFx0XHQkUUpMb2dnZXIubG9nKCdRSkhlbHBlciAtPiBUb2tlbiAtPiBleHBpcmVkJyk7XG5cdFx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdFx0JFFKTG9nZ2VyLmxvZygnUUpIZWxwZXIgLT4gVG9rZW4gLT4gZXhwaXJlcyBpbiAnICsgZXhwaXJhdGlvblNlY29uZHMgKyAnIHNlY29uZHMnKTtcblx0XHRcdFx0fVxuXG5cblx0XHRcdH1cblx0XHR9O1xuXG5cdH1cbl0pO1xufSkuY2FsbCh0aGlzLHJlcXVpcmUoXCIrN1pKcDBcIiksdHlwZW9mIHNlbGYgIT09IFwidW5kZWZpbmVkXCIgPyBzZWxmIDogdHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiA/IHdpbmRvdyA6IHt9LHJlcXVpcmUoXCJidWZmZXJcIikuQnVmZmVyLGFyZ3VtZW50c1szXSxhcmd1bWVudHNbNF0sYXJndW1lbnRzWzVdLGFyZ3VtZW50c1s2XSxcIi8uLi9zZXJ2aWNlcy9jb25maWdTZXJ2aWNlLmpzXCIsXCIvLi4vc2VydmljZXNcIikiLCIoZnVuY3Rpb24gKHByb2Nlc3MsZ2xvYmFsLEJ1ZmZlcixfX2FyZ3VtZW50MCxfX2FyZ3VtZW50MSxfX2FyZ3VtZW50MixfX2FyZ3VtZW50MyxfX2ZpbGVuYW1lLF9fZGlybmFtZSl7XG52YXIgbW9kdWxlID0gcmVxdWlyZSgnLi9fbW9kdWxlX2luaXQuanMnKTtcbm1vZHVsZS5mYWN0b3J5KCckUUpFcnJvckhhbmRsZXInLCBbXG4gICAgJyRRSkxvZ2dlcicsICckc3RhdGUnLCAnJHRpbWVvdXQnLCAnJHJvb3RTY29wZScsXG4gICAgZnVuY3Rpb24oJFFKTG9nZ2VyLCAkc3RhdGUsICR0aW1lb3V0LCAkcm9vdFNjb3BlKSB7XG4gICAgICAgIHZhciBjb2RlcyA9IHtcbiAgICAgICAgICAgIEFQSV9FUlJPUjogMCwgLy9DTElFTlQgU0lERVxuICAgICAgICAgICAgQVBJX0lOVkFMSURfUkVTUE9OU0U6IDEsIC8vQ0xJRU5UIFNJREVcbiAgICAgICAgICAgIEFQSV9SRVNQT05TRV9IQVNfRVJST1JTOiAyLCAvL1NFUlZFUiBTSURFIEtOT1dTXG4gICAgICAgICAgICBBUElfVE9LRU5fRVhQSVJFRDogMywgLy9TRVJWRVIgU0lERSBLTk9XU1xuICAgICAgICAgICAgQVBJX0lOVkFMSURfVE9LRU46IDQsIC8vU0VSVkVSIFNJREUgS05PV1NcbiAgICAgICAgICAgIEFQSV9JTlZBTElEX0NSRURFTlRJQUxTOiA1LCAvL1NFUlZFUiBTSURFIEtOT1dTXG4gICAgICAgICAgICBBUElfUk9VVEVfTk9UX0ZPVU5EOiA2LCAvL1NFUlZFUiBTSURFIEtOT1dTXG4gICAgICAgICAgICBBUElfUkVTUE9OU0VfSEFTX0VSUk9SU19XSVRIT1VUX0VSUk9SQ09ERTogNyxcbiAgICAgICAgICAgIEFQSV9JTlRFUk5BTF9TRVJWRVJfRVJST1I6IDUwMFxuICAgICAgICB9O1xuICAgICAgICB2YXIgY2hhbmdlU3RhdGUgPSBmdW5jdGlvbihzdGF0ZU5hbWUpIHtcbiAgICAgICAgICAgICR0aW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgICRzdGF0ZS5nbyhzdGF0ZU5hbWUpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH07XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBjb2RlczogY29kZXMsXG4gICAgICAgICAgICBoYW5kbGU6IGZ1bmN0aW9uKGNvZGUsIHJlc3BvbnNlKSB7XG4gICAgICAgICAgICAgICAgJHJvb3RTY29wZS5sYXN0UmVzcG9uc2UgPSByZXNwb25zZTtcblxuXG4gICAgICAgICAgICAgICAgdmFyIHZhbHMgPSBfLm1hcChyZXNwb25zZSwgZnVuY3Rpb24obnVtLCBrZXkpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG51bVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIHZhciBjb250YWN0ZW5lZFJlc3BvbnNlID0gJyc7XG4gICAgICAgICAgICAgICAgZm9yICh2YXIgeCBpbiB2YWxzKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnRhY3RlbmVkUmVzcG9uc2UgKz0gdmFsc1t4XTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY29udGFjdGVuZWRSZXNwb25zZSA9IGNvbnRhY3RlbmVkUmVzcG9uc2UudG9TdHJpbmcoKS5yZXBsYWNlKFwiLFwiLCBcIlwiKTtcblxuICAgICAgICAgICAgICAgICRyb290U2NvcGUubGFzdFJlc3BvbnNlQXNTdHJpbmcgPSB2YWxzO1xuICAgICAgICAgICAgICAgIC8vJHJvb3RTY29wZS5sYXN0UmVzcG9uc2VBc1N0cmluZyA9IEpTT04uc3RyaW5naWZ5KHJlc3BvbnNlKTtcblxuICAgICAgICAgICAgICAgICRyb290U2NvcGUuZXJyb3IgPSB7XG4gICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6IFwiU2VydmVyIEFQSSBubyBhY2Nlc2libGUuIEludGVudGUgbnVldmFtZW50ZSBtYXMgdGFyZGUgbyBjb25jdGFjdGUgYSBzb3BvcnRlLlwiXG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgc3dpdGNoIChjb2RlKSB7XG4gICAgICAgICAgICAgICAgICAgIGNhc2UgY29kZXMuQVBJX0VSUk9SOlxuICAgICAgICAgICAgICAgICAgICAgICAgY2hhbmdlU3RhdGUoXCJlcnJvci1hcGlcIik7XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgY2FzZSBjb2Rlcy5BUElfSU5URVJOQUxfU0VSVkVSX0VSUk9SOlxuICAgICAgICAgICAgICAgICAgICAgICAgJHJvb3RTY29wZS5lcnJvci5tZXNzYWdlID0gJyg1MDApIEludGVybmFsIHNlcnZlciBlcnJvci4gSW50ZW50ZSBudWV2YW1lbnRlIG1hcyB0YXJkZSBvIGNvbmN0YWN0ZSBhIHNvcG9ydGUuJztcbiAgICAgICAgICAgICAgICAgICAgICAgIGNoYW5nZVN0YXRlKFwiZXJyb3ItYXBpXCIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgIGNhc2UgY29kZXMuQVBJX0lOVkFMSURfUkVTUE9OU0U6XG4gICAgICAgICAgICAgICAgICAgICAgICAvL2NoYW5nZVN0YXRlKFwiZXJyb3ItaW52YWxpZC1yZXNwb25zZVwiKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybihcIklOVkFMSUQgUkVTUE9OU0UgLT4gXCIgKyBKU09OLnN0cmluZ2lmeShyZXNwb25zZSkudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9bXmEtekEtWl0rL2csIFwiLlwiKSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgY2FzZSBjb2Rlcy5BUElfUkVTUE9OU0VfSEFTX0VSUk9SUzpcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vY2hhbmdlU3RhdGUoXCJlcnJvci1yZXNwb25zZS1oYXMtZXJyb3JzXCIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS53YXJuKHJlc3BvbnNlLm1lc3NhZ2UgKyBcIiAtPiBcIiArIHJlc3BvbnNlLnVybCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgY2FzZSBjb2Rlcy5BUElfUkVTUE9OU0VfSEFTX0VSUk9SU19XSVRIT1VUX0VSUk9SQ09ERTpcbiAgICAgICAgICAgICAgICAgICAgICAgICRyb290U2NvcGUuZXJyb3IubWVzc2FnZSA9IFwiW0FQSV9SRVNQT05TRV9IQVNfRVJST1JTX1dJVEhPVVRfRVJST1JDT0RFXVtNZXNzYWdlLT4gXCIgKyByZXNwb25zZS5tZXNzYWdlICsgXCJdXCI7XG4gICAgICAgICAgICAgICAgICAgICAgICBjaGFuZ2VTdGF0ZShcImVycm9yLXJlc3BvbnNlLWhhcy1lcnJvcnNcIik7XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgY2FzZSBjb2Rlcy5BUElfVE9LRU5fRVhQSVJFRDpcbiAgICAgICAgICAgICAgICAgICAgICAgICRyb290U2NvcGUuZXJyb3IubWVzc2FnZSA9ICdTdSBzZXNzaW9uIGV4cGlybyc7XG4gICAgICAgICAgICAgICAgICAgICAgICBjaGFuZ2VTdGF0ZShcImxvZ2luXCIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgIGNhc2UgY29kZXMuQVBJX0lOVkFMSURfVE9LRU46XG4gICAgICAgICAgICAgICAgICAgICAgICAkcm9vdFNjb3BlLmVycm9yLm1lc3NhZ2UgPSAnVG9rZW4gaW52YWxpZCc7XG4gICAgICAgICAgICAgICAgICAgICAgICBjaGFuZ2VTdGF0ZShcImxvZ2luXCIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgIGNhc2UgY29kZXMuQVBJX0lOVkFMSURfQ1JFREVOVElBTFM6XG4gICAgICAgICAgICAgICAgICAgICAgICAkcm9vdFNjb3BlLmVycm9yLm1lc3NhZ2UgPSBcIkNyZWRlbmNpYWxlcyBpbnZhbGlkYXNcIjtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNoYW5nZVN0YXRlKFwibG9naW5cIik7XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgY2FzZSBjb2Rlcy5BUElfUk9VVEVfTk9UX0ZPVU5EOlxuICAgICAgICAgICAgICAgICAgICAgICAgJHJvb3RTY29wZS5lcnJvci5tZXNzYWdlID0gcmVzcG9uc2UubWVzc2FnZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vY2hhbmdlU3RhdGUoXCJlcnJvci1yZXNwb25zZS1oYXMtZXJyb3JzXCIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8kUUpMb2dnZXIubG9nKFwiQVBJX1JPVVRFX05PVF9GT1VORC0+XCIrcmVzcG9uc2UubWVzc2FnZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4ocmVzcG9uc2UubWVzc2FnZSArIFwiIC0+IFwiICsgcmVzcG9uc2UudXJsKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5pbmZvKFwiW1FKRXJyb3JIYW5kbGVyXVtVTktOT1cgRVJST1JdW0NPTlRBQ1QgU1VQUE9SVF1cIik7XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVha1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbl0pO1xufSkuY2FsbCh0aGlzLHJlcXVpcmUoXCIrN1pKcDBcIiksdHlwZW9mIHNlbGYgIT09IFwidW5kZWZpbmVkXCIgPyBzZWxmIDogdHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiA/IHdpbmRvdyA6IHt9LHJlcXVpcmUoXCJidWZmZXJcIikuQnVmZmVyLGFyZ3VtZW50c1szXSxhcmd1bWVudHNbNF0sYXJndW1lbnRzWzVdLGFyZ3VtZW50c1s2XSxcIi8uLi9zZXJ2aWNlcy9lcnJvckhhbmRsZXJTZXJ2aWNlLmpzXCIsXCIvLi4vc2VydmljZXNcIikiLCIoZnVuY3Rpb24gKHByb2Nlc3MsZ2xvYmFsLEJ1ZmZlcixfX2FyZ3VtZW50MCxfX2FyZ3VtZW50MSxfX2FyZ3VtZW50MixfX2FyZ3VtZW50MyxfX2ZpbGVuYW1lLF9fZGlybmFtZSl7XG52YXIgbW9kdWxlID0gcmVxdWlyZSgnLi9fbW9kdWxlX2luaXQuanMnKTtcbm1vZHVsZS5mYWN0b3J5KCckUUpIZWxwZXJGdW5jdGlvbnMnLCBbXG5cdCckUUpMb2dnZXInLCAnJFFKQXBpJywgJyRyb290U2NvcGUnLCAnJHN0YXRlJywgJyR0aW1lb3V0JywgJyRRSkVycm9ySGFuZGxlcicsXG5cdGZ1bmN0aW9uKCRRSkxvZ2dlciwgJFFKQXBpLCAkcm9vdFNjb3BlLCAkc3RhdGUsICR0aW1lb3V0LCAkUUpFcnJvckhhbmRsZXIpIHtcblx0XHR2YXIgc2VsZiA9IHt9O1xuXHRcdHNlbGYuY2hhbmdlU3RhdGUgPSBmdW5jdGlvbihzdGF0ZU5hbWUsIHBhcmFtcywgdGltZW91dCkge1xuXHRcdFx0JHRpbWVvdXQoZnVuY3Rpb24oKSB7XG5cdFx0XHRcdCRRSkxvZ2dlci5sb2coJ1FKSGVscGVyIC0+IFN0YXRlIC0+IGdvaW5nIHRvICcgKyBzdGF0ZU5hbWUgKyAnICB8IEN1cnJlbnQgLT4gJyArICRzdGF0ZS5jdXJyZW50Lm5hbWUpO1xuXHRcdFx0XHQkc3RhdGUuZ28oc3RhdGVOYW1lLCBwYXJhbXMpO1xuXHRcdFx0fSwgdGltZW91dCB8fCAwKTtcblx0XHR9O1xuXHRcdHNlbGYuY2hlY2tUb2tlbkV4cGlyYXRpb25BbmRHb1RvTG9naW5TdGF0ZUlmSGFzRXhwaXJlZCA9IGZ1bmN0aW9uKCkge1xuXHRcdFx0aWYgKCEkcm9vdFNjb3BlLnNlc3Npb24gfHwgKCRyb290U2NvcGUuc2Vzc2lvbiAmJiBfLmlzVW5kZWZpbmVkKCRyb290U2NvcGUuc2Vzc2lvbi50b2tlbkV4cCkpKSB7XG5cdFx0XHRcdCRRSkxvZ2dlci5sb2coJ1FKSGVscGVyIC0+IFRva2VuIC0+IG5vdCBhdmFsaWFibGUnKTtcblx0XHRcdFx0c2VsZi5jaGFuZ2VTdGF0ZSgnbG9naW4nKTtcblx0XHRcdFx0cmV0dXJuO1xuXHRcdFx0fVxuXHRcdFx0aWYgKCRyb290U2NvcGUuc2Vzc2lvbiAmJiAkcm9vdFNjb3BlLnNlc3Npb24udG9rZW5FeHAgPT0gbnVsbCkge1xuXHRcdFx0XHQkUUpMb2dnZXIubG9nKCdRSkhlbHBlciAtPiBUb2tlbiAtPiBub3QgYXZhbGlhYmxlJyk7XG5cdFx0XHRcdHNlbGYuY2hhbmdlU3RhdGUoJ2xvZ2luJyk7XG5cdFx0XHRcdHJldHVybjtcblx0XHRcdH1cblx0XHRcdHZhciBtaWxsaU5vdyA9IG5ldyBEYXRlKCkuZ2V0VGltZSgpO1xuXHRcdFx0dmFyIG1pbGxpRGlmZiA9IG1pbGxpTm93IC0gcGFyc2VJbnQoJHJvb3RTY29wZS5zZXNzaW9uLnRva2VuRXhwKTtcblx0XHRcdHZhciBleHBpcmF0aW9uU2Vjb25kcyA9IChNYXRoLmFicyhtaWxsaURpZmYpIC8gMTAwMCk7XG5cblx0XHRcdGlmIChtaWxsaURpZmYgPiAwKSB7XG5cdFx0XHRcdC8vU2kgZXMgcG9zaXRpdm8gc2lnbmlmaWNhIHF1ZSBlbCB0aWVtcG8gYWN0dWFsIGVzIG1heW9yIGFsIGRlIGV4cCwgcG9yIGxvIHF1ZSBlbCB0b2tlbiBleHBpcm8uXG5cdFx0XHRcdHNlbGYuY2hhbmdlU3RhdGUoJ2xvZ2luJyk7XG5cdFx0XHRcdCRRSkxvZ2dlci5sb2coJ1FKSGVscGVyIC0+IFRva2VuIC0+IGV4cGlyZWQnKTtcblx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdCRRSkxvZ2dlci5sb2coJ1FKSGVscGVyIC0+IFRva2VuIC0+IGV4cGlyZXMgaW4gJyArIGV4cGlyYXRpb25TZWNvbmRzICsgJyBzZWNvbmRzJyk7XG5cdFx0XHR9XG5cdFx0fTtcblxuXHRcdHNlbGYuZ2V0VGltZXN0YW1wRHVyYXRpb24gPSBmdW5jdGlvbih0aW1lc3RhbXApIHtcblx0XHRcdHZhciBkdXJhdGlvbiA9IHtcblx0XHRcdFx0aG91cnM6IE1hdGgucm91bmQoTWF0aC5mbG9vcih0aW1lc3RhbXAgLyAxMDAwIC8gNjAgLyA2MCkgJSAyNCksXG5cdFx0XHRcdG1pbnV0ZXM6IE1hdGgucm91bmQoTWF0aC5mbG9vcih0aW1lc3RhbXAgLyAxMDAwIC8gNjApICUgNjApLFxuXHRcdFx0XHRzZWNvbmRzOiBNYXRoLnJvdW5kKE1hdGguZmxvb3IodGltZXN0YW1wIC8gMTAwMCkgJSA2MClcblx0XHRcdH07XG5cdFx0XHR2YXIgc3RyID0gXCJcIjtcblx0XHRcdHN0ciArPSBkdXJhdGlvbi5ob3VycyArIFwiOlwiO1xuXHRcdFx0c3RyICs9IGR1cmF0aW9uLm1pbnV0ZXMgKyBcIjpcIjtcblx0XHRcdHN0ciArPSBkdXJhdGlvbi5zZWNvbmRzICsgXCJcIjtcblx0XHRcdHJldHVybiBzdHI7XG5cdFx0fTtcblxuXG5cblx0XHQvKlxuXHRcdHNlbGYuY2hlY2tBUElBbmRHb1RvQXBpRXJyb3JTdGF0ZUlmVGhlcmVJc0FQcm9ibGVtID0gZnVuY3Rpb24oKSB7XG5cdFx0XHQkUUpBcGkuaXNPSyhmdW5jdGlvbigpIHtcblx0XHRcdFx0JFFKTG9nZ2VyLmxvZygnUUpIZWxwZXIgLT4gQVBJIC0+IHdvcmtpbmcnKTtcblx0XHRcdH0sIGZ1bmN0aW9uKCkge1xuXHRcdFx0XHQkUUpMb2dnZXIubG9nKCdRSkhlbHBlciAtPiBBUEkgLT4gbm90IGF2YWxpYWJsZScpO1xuXHRcdFx0XHQkUUpFcnJvckhhbmRsZXIuaGFuZGxlKCRRSkVycm9ySGFuZGxlci5jb2Rlcy5BUElfVElNRU9VVCk7XG5cdFx0XHR9KTtcblx0XHR9O1xuXHRcdCovXG5cdFx0cmV0dXJuIHNlbGY7XG5cdH1cbl0pO1xufSkuY2FsbCh0aGlzLHJlcXVpcmUoXCIrN1pKcDBcIiksdHlwZW9mIHNlbGYgIT09IFwidW5kZWZpbmVkXCIgPyBzZWxmIDogdHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiA/IHdpbmRvdyA6IHt9LHJlcXVpcmUoXCJidWZmZXJcIikuQnVmZmVyLGFyZ3VtZW50c1szXSxhcmd1bWVudHNbNF0sYXJndW1lbnRzWzVdLGFyZ3VtZW50c1s2XSxcIi8uLi9zZXJ2aWNlcy9oZWxwZXJTZXJ2aWNlLmpzXCIsXCIvLi4vc2VydmljZXNcIikiLCIoZnVuY3Rpb24gKHByb2Nlc3MsZ2xvYmFsLEJ1ZmZlcixfX2FyZ3VtZW50MCxfX2FyZ3VtZW50MSxfX2FyZ3VtZW50MixfX2FyZ3VtZW50MyxfX2ZpbGVuYW1lLF9fZGlybmFtZSl7XG52YXIgbW9kdWxlID0gcmVxdWlyZSgnLi9fbW9kdWxlX2luaXQuanMnKTtcbm1vZHVsZS5mYWN0b3J5KCckUUpMb2NhbFNlc3Npb24nLCBbXG5cdCckcm9vdFNjb3BlJywgJyRodHRwJyxcblx0ZnVuY3Rpb24oJHJvb3RTY29wZSwgJGh0dHApIHtcblx0XHRyZXR1cm4ge1xuXHRcdFx0bG9hZDogZnVuY3Rpb24oKSB7XG5cdFx0XHRcdHJldHVybiBzdG9yZS5nZXQoXCJxal9cIiArICRyb290U2NvcGUuY29uZmlnLkFwcElkZW50aWZpZXIgKyBcIl9zZXNzaW9uXCIpIHx8IG51bGw7XG5cdFx0XHR9LFxuXHRcdFx0c2F2ZTogZnVuY3Rpb24oKSB7XG5cdFx0XHRcdCRodHRwLmRlZmF1bHRzLmhlYWRlcnMuY29tbW9uWydhdXRoLXRva2VuJ10gPSAkcm9vdFNjb3BlLnNlc3Npb24udG9rZW47XG5cdFx0XHRcdHN0b3JlLnNldChcInFqX1wiICsgJHJvb3RTY29wZS5jb25maWcuQXBwSWRlbnRpZmllciArIFwiX3Rva2VuXCIsICRyb290U2NvcGUuc2Vzc2lvbi50b2tlbik7XG5cdFx0XHRcdHN0b3JlLnNldChcInFqX1wiICsgJHJvb3RTY29wZS5jb25maWcuQXBwSWRlbnRpZmllciArIFwiX3Nlc3Npb25cIiwgJHJvb3RTY29wZS5zZXNzaW9uKTtcblx0XHRcdFx0c2Vzc2lvbiA9ICRyb290U2NvcGUuc2Vzc2lvbjtcblx0XHRcdH1cblx0XHR9XG5cdH1cbl0pO1xufSkuY2FsbCh0aGlzLHJlcXVpcmUoXCIrN1pKcDBcIiksdHlwZW9mIHNlbGYgIT09IFwidW5kZWZpbmVkXCIgPyBzZWxmIDogdHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiA/IHdpbmRvdyA6IHt9LHJlcXVpcmUoXCJidWZmZXJcIikuQnVmZmVyLGFyZ3VtZW50c1szXSxhcmd1bWVudHNbNF0sYXJndW1lbnRzWzVdLGFyZ3VtZW50c1s2XSxcIi8uLi9zZXJ2aWNlcy9sb2NhbFNlc3Npb25TZXJ2aWNlLmpzXCIsXCIvLi4vc2VydmljZXNcIikiLCIoZnVuY3Rpb24gKHByb2Nlc3MsZ2xvYmFsLEJ1ZmZlcixfX2FyZ3VtZW50MCxfX2FyZ3VtZW50MSxfX2FyZ3VtZW50MixfX2FyZ3VtZW50MyxfX2ZpbGVuYW1lLF9fZGlybmFtZSl7XG52YXIgbW9kdWxlID0gcmVxdWlyZSgnLi9fbW9kdWxlX2luaXQuanMnKTtcbm1vZHVsZS5mYWN0b3J5KCckUUpMb2dnZXInLCBbXG5cdCckcm9vdFNjb3BlJywgJyRzdGF0ZScsICckdGltZW91dCcsXG5cdGZ1bmN0aW9uKCRyb290U2NvcGUsICRzdGF0ZSwgJHRpbWVvdXQpIHtcblx0XHRyZXR1cm4ge1xuXHRcdFx0bG9nOiBmdW5jdGlvbihtc2cpIHtcblx0XHRcdFx0dmFyIGFwcE5hbWUgPSAkcm9vdFNjb3BlLmNvbmZpZy5hcHBOYW1lO1xuXHRcdFx0XHRjb25zb2xlLmluZm8oJ1snICsgYXBwTmFtZSArICddWycgKyBtc2cgKyAnXScpO1xuXHRcdFx0fVxuXHRcdH1cblx0fVxuXSk7XG59KS5jYWxsKHRoaXMscmVxdWlyZShcIis3WkpwMFwiKSx0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30scmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIsYXJndW1lbnRzWzNdLGFyZ3VtZW50c1s0XSxhcmd1bWVudHNbNV0sYXJndW1lbnRzWzZdLFwiLy4uL3NlcnZpY2VzL2xvZ2dlclNlcnZpY2UuanNcIixcIi8uLi9zZXJ2aWNlc1wiKSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbnZhciBtb2R1bGUgPSByZXF1aXJlKCcuL19tb2R1bGVfaW5pdC5qcycpO1xubW9kdWxlLmZhY3RvcnkoJyRRSkxvZ2luTW9kdWxlJywgW1xuXG5cdCckUUpMb2dnZXInLCAnJFFKQXV0aCcsIFwiJFFKQ29uZmlnXCIsIFwiJFFKQXBpXCIsIFwiJHJlc291cmNlXCIsIFwiJHJvb3RTY29wZVwiLCAnJFFKTG9jYWxTZXNzaW9uJyxcblx0ZnVuY3Rpb24oJFFKTG9nZ2VyLCAkUUpBdXRoLCAkUUpDb25maWcsICRRSkFwaSwgJHJlc291cmNlLCAkcm9vdFNjb3BlLCAkUUpMb2NhbFNlc3Npb24pIHtcblx0XHR2YXIgcnRhID0gbmV3KGZ1bmN0aW9uKCkge1xuXHRcdFx0Ly8tLUNMQVNTIERFRlxuXHRcdFx0dmFyIHNlbGYgPSB0aGlzO1xuXHRcdFx0Ly9cblx0XHRcdHNlbGYubG9naW4gPSBmdW5jdGlvbihsb2dpbm5hbWUsIHBhc3N3b3JkLCBzdWNjZXNzLCBmYWlsdXJlKSB7XG5cdFx0XHRcdHZhciByZXFEYXRhID0ge1xuXHRcdFx0XHRcdFwibG9naW5uYW1lXCI6IGxvZ2lubmFtZSxcblx0XHRcdFx0XHRcInBhc3N3b3JkXCI6IHBhc3N3b3JkLFxuXHRcdFx0XHRcdFwidG9rZW5SZXFcIjogbmV3IERhdGUoKS5nZXRUaW1lKCksXG5cdFx0XHRcdFx0J19ncm91cF9pZCc6ICRyb290U2NvcGUuY29uZmlnLl9ncm91cF9pZCxcblx0XHRcdFx0fTtcblx0XHRcdFx0JFFKTG9nZ2VyLmxvZygnUUpMb2dpbk1vZHVsZSAtPiByZXFEYXRhJyk7XG5cdFx0XHRcdC8vY29uc29sZS5pbmZvKHJlcURhdGEpO1xuXHRcdFx0XHR2YXIgQXV0aCA9ICRRSkFwaS5nZXRDb250cm9sbGVyKFwiYXV0aFwiKTtcblx0XHRcdFx0QXV0aC5wb3N0KHtcblx0XHRcdFx0XHRhY3Rpb246IFwibG9naW5cIlxuXHRcdFx0XHR9LCByZXFEYXRhLCBmdW5jdGlvbihyZXMpIHtcblx0XHRcdFx0XHQkUUpMb2dnZXIubG9nKCdRSkxvZ2luIC0+IHN1Y2Nlc3MnKTtcblx0XHRcdFx0XHQkUUpBdXRoLnVwZGF0ZVNlc3Npb25Gcm9tTG9naW4ocmVzKTtcblx0XHRcdFx0XHRzdWNjZXNzKCk7XG5cdFx0XHRcdH0pO1xuXHRcdFx0fTtcblx0XHRcdHJldHVybiBzZWxmO1xuXHRcdFx0Ly8tLUNMQVNTIERFRlxuXHRcdH0pKCk7XG5cdFx0cmV0dXJuIHJ0YTsgLy9mYWN0b3J5IHJldHVyblxuXHR9XG5dKTtcbn0pLmNhbGwodGhpcyxyZXF1aXJlKFwiKzdaSnAwXCIpLHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvLi4vc2VydmljZXMvbG9naW5TZXJ2aWNlLmpzXCIsXCIvLi4vc2VydmljZXNcIikiXX0=