/**
 * Utility functions for extracting accurate client IP addresses
 */

/**
 * Get accurate client IP address from request
 * Handles proxies, load balancers, and X-Forwarded-For headers
 */
export function getClientIP(req) {
  // Check X-Forwarded-For header (most common for proxies)
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    // X-Forwarded-For can contain multiple IPs, get the first one (original client)
    const ips = forwardedFor.split(',').map(ip => ip.trim());
    if (ips.length > 0 && ips[0]) {
      return ips[0];
    }
  }
  
  // Check X-Real-IP header (some proxies use this)
  const realIP = req.headers['x-real-ip'];
  if (realIP) {
    return realIP;
  }
  
  // Check CF-Connecting-IP (Cloudflare)
  const cfIP = req.headers['cf-connecting-ip'];
  if (cfIP) {
    return cfIP;
  }
  
  // Fallback to Express's req.ip (requires trust proxy)
  if (req.ip) {
    return req.ip;
  }
  
  // Last resort: connection remote address
  if (req.connection && req.connection.remoteAddress) {
    return req.connection.remoteAddress;
  }
  
  if (req.socket && req.socket.remoteAddress) {
    return req.socket.remoteAddress;
  }
  
  return 'unknown';
}




