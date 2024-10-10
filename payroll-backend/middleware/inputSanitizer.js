const sanitizeHtml = require('sanitize-html');

const sanitizeInput = (obj) => {
  for (let prop in obj) {
    if (typeof obj[prop] === 'string') {
      obj[prop] = sanitizeHtml(obj[prop], {
        allowedTags: [],
        allowedAttributes: {}
      });
    } else if (typeof obj[prop] === 'object' && obj[prop] !== null) {
      sanitizeInput(obj[prop]);
    }
  }
};

const inputSanitizer = (req, res, next) => {
  sanitizeInput(req.body);
  sanitizeInput(req.params);
  sanitizeInput(req.query);
  next();
};

module.exports = inputSanitizer;