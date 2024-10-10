const errorHandler = (err, req, res, next) => {
    console.error(err.stack);
  
    // Determine if the error is a known operational error
    if (err.isOperational) {
      return res.status(err.statusCode || 400).json({
        error: err.message
      });
    }
  
    // For unknown errors, send a generic server error response
    res.status(500).json({
      error: 'An unexpected error occurred on the server.'
    });
  };
  
  module.exports = errorHandler;