# UTIF.js
A small, fast and advanced TIFF / EXIF (+ DNG and other TIFF-ish files) decoder and encoder. It is the main TIFF library for [Photopea image editor](https://www.photopea.com). Try to open your TIFF file with Photopea to see, if UTIF.js can parse it.

* Supports Black & White, Grayscale, RGB and Paletted images
* Supports Fax 3 and Fax 4 (CCITT), LZW, PackBits and other compressions
* E.g. [this 8 MPix image](//www.photopea.com/api/img/G4.TIF) with Fax 4 compression is just 56 kB ( [Open in Photopea](https://www.photopea.com?p=%7B%22files%22:%5B%22//www.photopea.com/api/img/G4.TIF%22%5D%7D) )

## Installation

Download and include the `UTIF.js` file in your code. If you're in NodeJS or otherwise using NPM, run:

```sh
npm install utif
```

#### `UTIF.decode(buffer)`
* `buffer`: ArrayBuffer containing TIFF or EXIF data
* returns an array of "images" (or "layers", "pages"). Each element of this array is an object with following properties:
* * `width`: the width of the image
* * `height`: the height of the image
* * `data`: decompressed pixel data of the image
* * `tXYZ`: other TIFF tags

TIFF files may have different number of channels and different color depth. The interpretation of `data` depends on many tags (see the [TIFF 6 specification](http://www.npes.org/pdf/TIFF-v6.pdf)).

#### `UTIF.toRGBA8(img)`
* `img`: TIFF image object (returned by UTIF.decode())
* returns Uint8Array of the image in RGBA format, 8 bits per channel (ready to use in ctx.putImageData() etc.)

### Example

```javascript
function imgLoaded(e) {
  var pages = UTIF.decode(e.target.response);
  var rgba  = UTIF.toRGBA8(pages[0]);  // Uint8Array with RGBA pixels
  console.log(pages[0].width, pages[0].height, pages[0]);
}

var xhr = new XMLHttpRequest();
xhr.open("GET", "my_image.tif");
xhr.responseType = "arraybuffer";
xhr.onload = imgLoaded;   xhr.send();
```

### Example (Using file input)

```html
<input type="file" id="file_input">
```
```javascript
var fi = document.getElementById('file_input');
fi.addEventListener('change', function(e) {
    var files = e.target.files;
    for (var i = 0, len = files.length; i < len; i++) {
        readFile(files[i]);
    }
});

function readFile(file) {
    var fr = new FileReader();
    fr.onload = function(e) {
        var page = UTIF.decode(this.result)[0];
        var rgba = UTIF.toRGBA8(page),
            w    = page.width,
            h    = page.height
        ;
        var cnv = document.createElement("canvas");
        cnv.width  = w;
        cnv.height = h;
        var ctx  = cnv.getContext("2d"),
            imgd = ctx.createImageData(w, h)
        ;
        for(var i=0, len = rgba.length; i<len; i++) {
            imgd.data[i] = rgba[i];
        }
        ctx.putImageData(imgd,0,0);
        document.body.appendChild(cnv);
    }
    fr.readAsArrayBuffer(file);
}
```

## Use TIFF images in HTML

If you are not a programmer, you can use TIFF images directly inside the `<img>` element of HTML. Then, it is enough to call `UTIF.replaceIMG()` once at some point.

#### `UTIF.replaceIMG()`
```html
<body onload="UTIF.replaceIMG()">
...
<img src="image.tif" />  <img src="dog.tif" /> ...
```
And UTIF.js will do the rest. Internally, an Image elements will be replaced by a Canvas elements. The attributes "id", "class" and "style" will be copied from the original Image to the new Canvas. Use CSS to style such images.


## Encoding TIFF images

You should not save images into TIFF format in the 21st century. Save them as PNG instead (e.g. using [UPNG.js](https://github.com/photopea/UPNG.js)). If you still want to use TIFF format for some reason, here it is.

#### `UTIF.encodeImage(rgba, w, h, metadata)`
* `rgba`: ArrayBuffer containing RGBA pixel data
* `w`: image width
* `h`: image height
* `metadata` [optional]: IFD object (see below)
* returns ArrayBuffer of the binary TIFF file. No compression right now.

#### `UTIF.encode(ifds)`
* `ifds`: array of IFDs (image file directories). An IFD is a JS object with properties "tXYZ" (where XYZ are TIFF tags)
* returns ArrayBuffer of binary data. You can use it to encode EXIF data.

## Dependencies
TIFF format sometimes uses Inflate algorithm for compression (but it is quite rare). Right now, UTIF.js calls [Pako.js](https://github.com/nodeca/pako) for the Inflate method.
TIFF format sometimes uses JPEG compression (but it is quite rare). Right now, UTIF.js calls "JpegDecoder" constructor, which comes from [pdf.js](https://github.com/mozilla/pdf.js). You can find it "separated" from pdf.js in libraries such as jpg.js.
