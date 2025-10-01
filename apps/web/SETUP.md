# Cursor Session Helper Setup Guide

This guide explains how to set up and deploy the Cursor Session Helper extension and server components.

## Security Considerations

1. The extension only requests access to *.cursor.sh domains, not Google domains
2. All communication is enforced over HTTPS
3. Session data is encrypted at rest using AES-GCM
4. Cookies are treated as sensitive credentials and rotated on 401 responses
5. The encryption key is stored in the OS key vault or environment variables

## Server Setup

1. Generate a secure encryption key:
   ```bash
   openssl rand -hex 32
   ```

2. Set the encryption key in your environment:
   ```bash
   export SESSION_ENCRYPTION_KEY=<generated-key>
   ```

3. For production deployment, ensure:
   - HTTPS is enforced
   - The encryption key is securely stored (e.g., AWS Secrets Manager, Azure Key Vault)
   - Session data is stored in a secure database with encryption at rest
   - Regular key rotation is implemented
   - Access logs are maintained for audit purposes

## Extension Packaging

1. Install dependencies:
   ```bash
   npm install
   ```

2. Generate extension package:
   ```bash
   npm run package-extension
   ```

3. The extension will be available at `public/dist/cursor-session-helper.zip`

## Extension Installation (For Users)

1. Download the extension from the login helper page
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Drag and drop the downloaded .zip file into Chrome
5. The extension icon will appear in your toolbar
6. Click the icon and use "Capture Session Data" when needed

## Troubleshooting

1. Extension not capturing session:
   - Ensure you're logged into Cursor
   - Check that you're on a cursor.sh domain
   - Verify the extension has the required permissions

2. Upload failures:
   - Verify HTTPS connection
   - Check server logs for encryption errors
   - Ensure the encryption key is properly set
   - Verify database connectivity

## Security Best Practices

1. Regular Updates:
   - Keep the extension updated with the latest security patches
   - Rotate encryption keys periodically
   - Monitor for suspicious access patterns

2. Access Control:
   - Limit extension distribution to authorized users
   - Implement role-based access control for the upload endpoint
   - Log all session capture and upload events

3. Data Protection:
   - Implement session data retention policies
   - Regularly audit stored session data
   - Implement secure deletion procedures

4. Monitoring:
   - Monitor for unauthorized access attempts
   - Track session usage patterns
   - Alert on unusual activity

## Development

To modify the extension:

1. Make changes to the extension code in `public/extension/`
2. Test locally by loading the unpacked extension
3. Update the version in `manifest.json`
4. Rebuild using `npm run package-extension`
