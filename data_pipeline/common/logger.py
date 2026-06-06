import logging
import sys


def configure_logger(name: str, level: str = "INFO") -> logging.Logger:
    """Configure and return a logger with the specified name and level.
    
    Args:
        name: Logger name (typically __name__ from the calling module).
        level: Log level as string (INFO, DEBUG, WARNING, ERROR). Default: INFO.
        
    Returns:
        Configured logger instance.
    """
    logger = logging.getLogger(name)
    log_level = getattr(logging, level.upper(), logging.INFO)
    logger.setLevel(log_level)
    formatter = logging.Formatter(
        '[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    if logger.handlers:
        logger.handlers.clear()
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(log_level)
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)
    logger.propagate = False
    return logger


def get_logger(name: str) -> logging.Logger:
    """Get or create a logger instance with INFO level.
    
    Args:
        name: Logger name (typically __name__ from the calling module).
        
    Returns:
        Configured logger instance.
    """
    return configure_logger(name)
