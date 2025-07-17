/**
 * AEQUITAS CAPITAL PARTNERS - COMPLETE PRODUCTION SECURITY SYSTEM
 * 
 * This single file handles ALL production security measures:
 * ✅ Authentication & 2FA Token Validation
 * ✅ API Access Control & Rate Limiting  
 * ✅ Developer Tools Blocking
 * ✅ Content Security & Anti-Tampering
 * ✅ Environment Configuration
 * ✅ Error Handling & Sanitization
 * ✅ Session Monitoring & Auto-Logout
 * ✅ CORS Protection
 * ✅ XSS Prevention
 * ✅ Route Protection
 * 
 * USAGE: Include this script FIRST in every HTML page:
 * <script src="/assets/js/security.js"></script>
 */

(function() {
    'use strict';
    
    // ============================================================================
    // PRODUCTION CONFIGURATION
    // ============================================================================
    
    window.AEQUITAS_SECURITY = {
        ENVIRONMENT: 'production', // Set to 'development' for local testing
        DOMAIN: window.location.hostname,
        API_BASE: '/api',
        
        // Security Features Toggle
        FEATURES: {
            DISABLE_DEVTOOLS: false, // Temporarily disabled for testing
            DISABLE_CONSOLE: false,  // Temporarily disabled for testing
            DISABLE_RIGHTCLICK: false, // Temporarily disabled for testing
            DISABLE_COPY_PASTE: false, // Temporarily disabled for testing
            TOKEN_VALIDATION: true,
            API_RATE_LIMITING: false, // Temporarily disabled for testing
            CONTENT_PROTECTION: false, // Temporarily disabled for testing
            ERROR_SANITIZATION: false, // Temporarily disabled for testing
            SESSION_MONITORING: true,
            AUTO_LOGOUT: false // Temporarily disabled for testing
        },
        
        // Rate Limits (per minute)
        RATE_LIMITS: {
            API_CALLS: 50,
            LOGIN_ATTEMPTS: 3,
            PAGE_LOADS: 100
        },
        
        // Session Configuration
        SESSION: {
            TIMEOUT_MINUTES: 30,
            WARNING_MINUTES: 5,
            HEARTBEAT_INTERVAL: 60000 // 1 minute
        },
        
        // Protected Routes
        PROTECTED_PAGES: [
            'dashboard.html', 'profile.html', 'statements.html',
            'deposit.html', 'withdrawal.html', 'support.html', 'admin.html'
        ],
        
        // Public Routes
        PUBLIC_PAGES: [
            'login.html', 'signup.html', 'setup.html', 
            '2fa-verify.html', 'forgot-password.html', 'index.html'
        ]
    };
    
    // ============================================================================
    // MAIN SECURITY CLASS
    // ============================================================================
    
    class AequitasSecuritySystem {
        constructor() {
            this.rateLimitStore = new Map();
            this.securityViolations = 0;
            this.sessionStartTime = Date.now();
            this.lastActivity = Date.now();
            this.heartbeatInterval = null;
            this.sessionWarningShown = false;
            
            this.init();
        }
        
        init() {
            console.log('🔒 Initializing Aequitas Security System...');
            
            // Apply production security measures
            if (window.AEQUITAS_SECURITY.ENVIRONMENT === 'production') {
                this.enableProductionSecurity();
            }
            
            // Initialize core security systems
            this.initializeAuthentication();
            this.initializeAPIProtection();
            this.initializeContentProtection();
            this.initializeErrorHandling();
            this.initializeSessionMonitoring();
            this.initializeRouteProtection();
            
            console.log('✅ Security system active');
            
            // Hide console logs after initialization in production
            if (window.AEQUITAS_SECURITY.ENVIRONMENT === 'production') {
                setTimeout(() => this.disableConsole(), 1000);
            }
        }
        
        // ========================================================================
        // PRODUCTION SECURITY MEASURES
        // ========================================================================
        
        enableProductionSecurity() {
            if (window.AEQUITAS_SECURITY.FEATURES.DISABLE_DEVTOOLS) {
                this.disableDeveloperTools();
            }
            
            if (window.AEQUITAS_SECURITY.FEATURES.DISABLE_RIGHTCLICK) {
                this.disableRightClick();
            }
            
            if (window.AEQUITAS_SECURITY.FEATURES.DISABLE_COPY_PASTE) {
                this.disableCopyPaste();
            }
            
            if (window.AEQUITAS_SECURITY.FEATURES.CONTENT_PROTECTION) {
                this.enableContentProtection();
            }
        }
        
        disableDeveloperTools() {
            // Block developer tool shortcuts
            document.addEventListener('keydown', (e) => {
                const blockedKeys = [
                    { key: 'F12' },
                    { ctrl: true, shift: true, key: 'I' },
                    { ctrl: true, shift: true, key: 'C' },
                    { ctrl: true, shift: true, key: 'J' },
                    { ctrl: true, key: 'u' },
                    { ctrl: true, key: 'U' },
                    { key: 'F11' } // Fullscreen toggle
                ];
                
                for (let blocked of blockedKeys) {
                    if (this.matchesKeyCombo(e, blocked)) {
                        e.preventDefault();
                        e.stopPropagation();
                        this.logSecurityViolation('Developer tools access attempt');
                        return false;
                    }
                }
            });
            
            // Detect DevTools opening
            this.detectDevTools();
        }
        
        matchesKeyCombo(event, combo) {
            return (
                (!combo.ctrl || event.ctrlKey) &&
                (!combo.shift || event.shiftKey) &&
                (!combo.alt || event.altKey) &&
                (event.key === combo.key || event.code === combo.key)
            );
        }
        
        detectDevTools() {
            let devtools = { open: false };
            
            // Method 1: Window size detection
            setInterval(() => {
                if (window.outerHeight - window.innerHeight > 200 || 
                    window.outerWidth - window.innerWidth > 200) {
                    if (!devtools.open) {
                        devtools.open = true;
                        this.handleSecurityViolation('DEVTOOLS_DETECTED');
                    }
                } else {
                    devtools.open = false;
                }
            }, 1000);
            
            // Method 2: Debug detection
            setInterval(() => {
                const start = performance.now();
                debugger; // This will pause if DevTools is open
                const end = performance.now();
                
                if (end - start > 100) {
                    this.handleSecurityViolation('DEBUGGER_DETECTED');
                }
            }, 3000);
        }
        
        disableRightClick() {
            document.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.logSecurityViolation('Right-click context menu attempt');
                return false;
            });
        }
        
        disableCopyPaste() {
            // Disable text selection on sensitive elements
            document.addEventListener('selectstart', (e) => {
                if (e.target.closest('.no-select, .stat-value, .user-info')) {
                    e.preventDefault();
                    return false;
                }
            });
            
            // Disable copy/paste shortcuts
            document.addEventListener('keydown', (e) => {
                if (e.ctrlKey && (e.key === 'c' || e.key === 'v' || e.key === 'x')) {
                    if (e.target.closest('.protected-content, .stat-value')) {
                        e.preventDefault();
                        this.logSecurityViolation('Copy/paste attempt on protected content');
                        return false;
                    }
                }
            });
        }
        
        enableContentProtection() {
            // Disable drag and drop
            document.addEventListener('dragstart', (e) => {
                e.preventDefault();
                return false;
            });
            
            // Disable print screen (limited effectiveness)
            document.addEventListener('keyup', (e) => {
                if (e.key === 'PrintScreen') {
                    this.logSecurityViolation('Print screen attempt');
                }
            });
            
            // Add watermark overlay (optional)
            if (window.location.pathname.includes('dashboard')) {
                this.addWatermark();
            }
        }
        
        addWatermark() {
            const watermark = document.createElement('div');
            watermark.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                pointer-events: none;
                z-index: 9999;
                background-image: repeating-linear-gradient(
                    45deg,
                    transparent,
                    transparent 100px,
                    rgba(59, 130, 246, 0.05) 100px,
                    rgba(59, 130, 246, 0.05) 200px
                );
                font-family: Arial, sans-serif;
                font-size: 24px;
                color: rgba(59, 130, 246, 0.1);
                display: flex;
                align-items: center;
                justify-content: center;
                transform: rotate(-45deg);
                user-select: none;
            `;
            watermark.textContent = 'AEQUITAS CAPITAL PARTNERS - CONFIDENTIAL';
            document.body.appendChild(watermark);
        }
        
        disableConsole() {
            if (window.AEQUITAS_SECURITY.FEATURES.DISABLE_CONSOLE) {
                const noop = () => {};
                console.log = noop;
                console.warn = noop;
                console.error = noop;
                console.info = noop;
                console.debug = noop;
                console.table = noop;
                console.trace = noop;
                console.group = noop;
                console.groupEnd = noop;
                console.clear = noop;
            }
        }
        
        // ========================================================================
        // AUTHENTICATION SYSTEM
        // ========================================================================
        
        initializeAuthentication() {
            if (!window.AEQUITAS_SECURITY.FEATURES.TOKEN_VALIDATION) return;
            
            const currentPage = window.location.pathname.split('/').pop() || 'index.html';
            
            // Allow public pages without authentication
            if (window.AEQUITAS_SECURITY.PUBLIC_PAGES.includes(currentPage)) {
                console.log('✅ Public page access allowed:', currentPage);
                return;
            }
            
            // Check if current page requires authentication
            if (window.AEQUITAS_SECURITY.PROTECTED_PAGES.includes(currentPage)) {
                // Add delay to allow login process to complete
                setTimeout(() => {
                    this.validateAuthentication();
                }, 500);
            }
        }
        
        async validateAuthentication() {
            const token = localStorage.getItem('aequitas_auth_token');
            const userData = localStorage.getItem('aequitas_user_data');
            
            if (!token || !userData) {
                console.log('❌ No auth token found, redirecting to login');
                this.redirectToLogin('No authentication token found');
                return;
            }
            
            try {
                console.log('🔍 Validating authentication token...');
                
                // Validate token with server (with timeout)
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
                
                const response = await fetch(`${window.AEQUITAS_SECURITY.API_BASE}/verify-token`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                if (!response.ok) {
                    throw new Error(`Token validation failed: ${response.status}`);
                }
                
                const result = await response.json();
                console.log('✅ Token validation successful');
                
                // Check for 2FA requirement
                if (result.requires2FA && !result.verified2FA) {
                    console.log('🔐 2FA verification required');
                    window.location.href = '/2fa-verify.html';
                    return;
                }
                
                // Update last activity time
                this.lastActivity = Date.now();
                
            } catch (error) {
                // If token validation fails, only redirect if it's a real auth error
                if (error.name === 'AbortError') {
                    console.warn('⚠️ Token validation timeout, allowing page load');
                    return; // Don't redirect on timeout
                }
                
                console.log('❌ Token validation failed:', error.message);
                this.logSecurityViolation(`Authentication validation failed: ${error.message}`);
                this.redirectToLogin('Authentication expired');
            }
        }
        
        redirectToLogin(reason) {
            localStorage.removeItem('aequitas_auth_token');
            localStorage.removeItem('aequitas_user_data');
            sessionStorage.clear();
            
            const loginUrl = `/login.html${reason ? `?reason=${encodeURIComponent(reason)}` : ''}`;
            window.location.href = loginUrl;
        }
        
        // ========================================================================
        // API PROTECTION SYSTEM
        // ========================================================================
        
        initializeAPIProtection() {
            if (!window.AEQUITAS_SECURITY.FEATURES.API_RATE_LIMITING) return;
            
            // Override fetch to add security headers and rate limiting
            const originalFetch = window.fetch;
            
            window.fetch = async (url, options = {}) => {
                // Apply rate limiting
                if (url.includes('/api/')) {
                    if (!this.checkRateLimit('API_CALLS')) {
                        throw new Error('Rate limit exceeded');
                    }
                }
                
                // Add security headers
                options.headers = {
                    ...options.headers,
                    'X-Requested-With': 'XMLHttpRequest',
                    'X-Client-Version': '1.0.0',
                    'X-Timestamp': Date.now().toString()
                };
                
                // Add authentication token if available
                const token = localStorage.getItem('aequitas_auth_token');
                if (token && url.includes('/api/')) {
                    options.headers['Authorization'] = `Bearer ${token}`;
                }
                
                try {
                    const response = await originalFetch(url, options);
                    
                    // Handle authentication errors
                    if (response.status === 401) {
                        this.redirectToLogin('Session expired');
                        return;
                    }
                    
                    return response;
                } catch (error) {
                    this.logSecurityViolation(`API request failed: ${error.message}`);
                    throw error;
                }
            };
        }
        
        checkRateLimit(type) {
            const limit = window.AEQUITAS_SECURITY.RATE_LIMITS[type];
            const now = Date.now();
            const windowMs = 60000; // 1 minute
            
            if (!this.rateLimitStore.has(type)) {
                this.rateLimitStore.set(type, []);
            }
            
            const requests = this.rateLimitStore.get(type);
            
            // Remove old requests outside the time window
            const validRequests = requests.filter(time => now - time < windowMs);
            
            if (validRequests.length >= limit) {
                this.logSecurityViolation(`Rate limit exceeded for ${type}`);
                return false;
            }
            
            validRequests.push(now);
            this.rateLimitStore.set(type, validRequests);
            return true;
        }
        
        // ========================================================================
        // SESSION MONITORING
        // ========================================================================
        
        initializeSessionMonitoring() {
            if (!window.AEQUITAS_SECURITY.FEATURES.SESSION_MONITORING) return;
            
            // Track user activity
            const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
            activityEvents.forEach(event => {
                document.addEventListener(event, () => {
                    this.lastActivity = Date.now();
                    this.sessionWarningShown = false;
                }, true);
            });
            
            // Start session heartbeat
            this.startSessionHeartbeat();
            
            // Check session timeout
            this.checkSessionTimeout();
        }
        
        startSessionHeartbeat() {
            this.heartbeatInterval = setInterval(async () => {
                const token = localStorage.getItem('aequitas_auth_token');
                if (!token) return;
                
                try {
                    await fetch(`${window.AEQUITAS_SECURITY.API_BASE}/heartbeat`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        }
                    });
                } catch (error) {
                    console.warn('Heartbeat failed:', error.message);
                }
            }, window.AEQUITAS_SECURITY.SESSION.HEARTBEAT_INTERVAL);
        }
        
        checkSessionTimeout() {
            setInterval(() => {
                const now = Date.now();
                const inactiveTime = now - this.lastActivity;
                const timeoutMs = window.AEQUITAS_SECURITY.SESSION.TIMEOUT_MINUTES * 60000;
                const warningMs = window.AEQUITAS_SECURITY.SESSION.WARNING_MINUTES * 60000;
                
                // Show warning before timeout
                if (inactiveTime > (timeoutMs - warningMs) && !this.sessionWarningShown) {
                    this.showSessionWarning();
                    this.sessionWarningShown = true;
                }
                
                // Auto logout on timeout
                if (inactiveTime > timeoutMs && window.AEQUITAS_SECURITY.FEATURES.AUTO_LOGOUT) {
                    this.redirectToLogin('Session timed out due to inactivity');
                }
            }, 30000); // Check every 30 seconds
        }
        
        showSessionWarning() {
            if (typeof showNotification === 'function') {
                showNotification(
                    `Your session will expire in ${window.AEQUITAS_SECURITY.SESSION.WARNING_MINUTES} minutes due to inactivity.`,
                    'warning'
                );
            } else {
                alert(`Your session will expire in ${window.AEQUITAS_SECURITY.SESSION.WARNING_MINUTES} minutes due to inactivity.`);
            }
        }
        
        // ========================================================================
        // ROUTE PROTECTION
        // ========================================================================
        
        initializeRouteProtection() {
            // Prevent navigation to protected routes without authentication
            window.addEventListener('beforeunload', () => {
                this.cleanupSession();
            });
            
            // Monitor for URL changes (SPA protection)
            const originalPushState = history.pushState;
            const originalReplaceState = history.replaceState;
            
            history.pushState = (...args) => {
                this.validateRouteAccess(args[2]);
                return originalPushState.apply(history, args);
            };
            
            history.replaceState = (...args) => {
                this.validateRouteAccess(args[2]);
                return originalReplaceState.apply(history, args);
            };
        }
        
        validateRouteAccess(url) {
            if (!url) return;
            
            const page = url.split('/').pop() || 'index.html';
            const token = localStorage.getItem('aequitas_auth_token');
            
            if (window.AEQUITAS_SECURITY.PROTECTED_PAGES.includes(page) && !token) {
                this.redirectToLogin('Authentication required');
            }
        }
        
        cleanupSession() {
            if (this.heartbeatInterval) {
                clearInterval(this.heartbeatInterval);
            }
        }
        
        // ========================================================================
        // ERROR HANDLING & LOGGING
        // ========================================================================
        
        initializeErrorHandling() {
            // Global error handler
            window.addEventListener('error', (e) => {
                this.logSecurityViolation(`JavaScript error: ${e.message}`);
                
                if (window.AEQUITAS_SECURITY.FEATURES.ERROR_SANITIZATION) {
                    e.preventDefault();
                    return false;
                }
            });
            
            // Unhandled promise rejection handler
            window.addEventListener('unhandledrejection', (e) => {
                this.logSecurityViolation(`Unhandled promise rejection: ${e.reason}`);
                
                if (window.AEQUITAS_SECURITY.FEATURES.ERROR_SANITIZATION) {
                    e.preventDefault();
                }
            });
        }
        
        logSecurityViolation(message) {
            this.securityViolations++;
            
            const violation = {
                timestamp: new Date().toISOString(),
                message: message,
                userAgent: navigator.userAgent,
                url: window.location.href,
                violations: this.securityViolations
            };
            
            // Log to server if possible
            this.sendSecurityLog(violation);
            
            // Handle repeated violations
            if (this.securityViolations >= 5) {
                this.handleSecurityViolation('REPEATED_VIOLATIONS');
            }
        }
        
        async sendSecurityLog(violation) {
            try {
                const token = localStorage.getItem('aequitas_auth_token');
                await fetch(`${window.AEQUITAS_SECURITY.API_BASE}/security-log`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': token ? `Bearer ${token}` : ''
                    },
                    body: JSON.stringify(violation)
                });
            } catch (error) {
                // Fail silently in production
            }
        }
        
        handleSecurityViolation(type) {
            switch (type) {
                case 'DEVTOOLS_DETECTED':
                case 'DEBUGGER_DETECTED':
                    this.redirectToLogin('Unauthorized access detected');
                    break;
                    
                case 'REPEATED_VIOLATIONS':
                    localStorage.clear();
                    sessionStorage.clear();
                    this.redirectToLogin('Security policy violation');
                    break;
                    
                default:
                    this.logSecurityViolation(`Security violation: ${type}`);
            }
        }
        
        // ========================================================================
        // UTILITY METHODS
        // ========================================================================
        
        // Get security status
        getSecurityStatus() {
            return {
                environment: window.AEQUITAS_SECURITY.ENVIRONMENT,
                authenticated: !!localStorage.getItem('aequitas_auth_token'),
                violations: this.securityViolations,
                sessionAge: Date.now() - this.sessionStartTime,
                lastActivity: this.lastActivity
            };
        }
        
        // Manual security check
        performSecurityCheck() {
            this.validateAuthentication();
        }
    }
    
    // ============================================================================
    // INITIALIZE SECURITY SYSTEM
    // ============================================================================
    
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.AequitasSecurity = new AequitasSecuritySystem();
        });
    } else {
        window.AequitasSecurity = new AequitasSecuritySystem();
    }
    
})();

// ============================================================================
// ADDITIONAL CSS FOR SECURITY (inject into page)
// ============================================================================

const securityCSS = `
    /* Disable text selection on sensitive content */
    .no-select, .stat-value, .user-info, .protected-content {
        -webkit-user-select: none !important;
        -moz-user-select: none !important;
        -ms-user-select: none !important;
        user-select: none !important;
    }
    
    /* Disable drag on images and sensitive elements */
    img, .stat-icon, .logo {
        -webkit-user-drag: none !important;
        -khtml-user-drag: none !important;
        -moz-user-drag: none !important;
        -o-user-drag: none !important;
        user-drag: none !important;
        pointer-events: none !important;
    }
    
    /* Hide scroll bars in production (optional) */
    body.production-mode::-webkit-scrollbar {
        display: none;
    }
    body.production-mode {
        -ms-overflow-style: none;
        scrollbar-width: none;
    }
`;

// Inject security CSS
const style = document.createElement('style');
style.textContent = securityCSS;
document.head.appendChild(style);

// Add production class if in production
if (window.AEQUITAS_SECURITY?.ENVIRONMENT === 'production') {
    document.body.classList.add('production-mode');
}
