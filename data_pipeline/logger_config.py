"""
Unified Logger Configuration for Data Pipeline

Format: [LEVEL] [MODULE] Message

Log Levels:
- DEBUG: Detailed information for debugging purposes
- INFO: General informational messages
- WARNING: Warning messages for potentially problematic situations
- ERROR: Error messages for failed operations

No emojis, icons, or special characters are used in log messages.
All messages are in English.
"""

import logging
import sys
from datetime import datetime


def configure_logger(name: str, level: str = "INFO") -> logging.Logger:
    """
    Configure and return a logger with unified format.
    
    Args:
        name: Logger name (usually module name)
        level: Log level (DEBUG, INFO, WARNING, ERROR)
    
    Returns:
        Configured logger instance
    """
    logger = logging.getLogger(name)
    
    # Set log level
    log_level = getattr(logging, level.upper(), logging.INFO)
    logger.setLevel(log_level)
    
    # Create formatter
    formatter = logging.Formatter(
        '[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    # Remove existing handlers to avoid duplicate logs
    if logger.handlers:
        logger.handlers.clear()
    
    # Create console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(log_level)
    console_handler.setFormatter(formatter)
    
    logger.addHandler(console_handler)
    
    # Prevent propagation to avoid duplicate logs
    logger.propagate = False
    
    return logger


def get_logger(name: str) -> logging.Logger:
    """
    Get or create a logger with the unified format.
    
    Args:
        name: Logger name (usually __name__)
    
    Returns:
        Logger instance with support for error logging with tracebacks
        
    Usage for error logging with traceback:
        try:
            # your code here
        except Exception as e:
            logger.error(f"Error message: {e}", exc_info=True)
    """
    return configure_logger(name)
