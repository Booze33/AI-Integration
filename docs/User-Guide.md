# AI Integration Platform User Guide

## Getting Started

The AI Integration Platform allows you to configure and manage multiple AI providers in a secure, multi-tenant environment.

## Dashboard

After logging in, you'll see the main dashboard with navigation to different sections:

- **Chat** - Interactive AI chat with voice input
- **Upload** - File processing and analysis
- **Settings** - AI provider configuration

## Configuring AI Providers

### Accessing Settings

1. Click "Settings" in the navigation
2. You'll see a list of your current AI provider configurations

### Adding a New Provider

1. Click "Add Configuration"
2. Select a provider from the dropdown (OpenAI, Anthropic, etc.)
3. Enter your API key
4. Configure optional settings:
   - Base URL (for custom endpoints)
   - Default model
   - Timeout settings
   - Retry settings

### Provider-Specific Setup

#### OpenAI

- Get your API key from [OpenAI Platform](https://platform.openai.com/api-keys)
- Default models: gpt-4, gpt-3.5-turbo

#### Anthropic

- Get your API key from [Anthropic Console](https://console.anthropic.com/)
- Default models: claude-3-opus, claude-3-sonnet

#### Deepgram

- Get your API key from [Deepgram Console](https://console.deepgram.com/)
- Used for speech-to-text transcription

#### ElevenLabs

- Get your API key from [ElevenLabs](https://elevenlabs.io/app/profile)
- Used for text-to-speech generation

### Managing Configurations

- **Edit**: Click the edit button to modify settings
- **Delete**: Click delete to remove a configuration
- **Active/Inactive**: Toggle configurations on/off

## Using the Chat Interface

### Text Chat

1. Type your message in the input field
2. Press Enter or click Send
3. The AI will respond with streaming text

### Voice Input

1. Click the microphone button
2. Grant microphone permissions if prompted
3. Speak your message
4. The speech will be transcribed and sent as text

### Chat History

- Previous conversations are saved automatically
- Click "Resume stream" to continue interrupted conversations
- History persists across sessions

## File Upload and Processing

### Supported Formats

- **Documents**: PDF, DOCX, TXT
- **Images**: JPG, PNG, GIF
- **Audio**: MP3, WAV, M4A

### Uploading Files

1. Click "Upload" in the navigation
2. Drag and drop files or click to browse
3. Monitor upload progress
4. View processing results

### Processing Features

- **Text Extraction**: Extract text from documents
- **Image Analysis**: Analyze images with AI
- **Audio Transcription**: Transcribe audio files

## Security Best Practices

### API Keys

- Never share your API keys
- Rotate keys regularly
- Use separate keys for different environments
- Monitor usage in your provider dashboards

### Account Security

- Use strong, unique passwords
- Enable two-factor authentication when available
- Log out when using shared computers
- Report suspicious activity

## Troubleshooting

### Common Issues

#### Login Problems

- Check email and password
- Clear browser cache
- Try a different browser

#### API Configuration

- Verify API keys are correct
- Check provider account limits
- Ensure correct base URLs

#### Voice Input

- Grant microphone permissions
- Check browser compatibility
- Try refreshing the page

#### File Upload

- Check file size limits
- Verify supported formats
- Ensure stable internet connection

### Getting Help

- Check the API documentation
- Review browser console for errors
- Contact your administrator

## Advanced Features

### Rate Limiting

The platform includes intelligent rate limiting:

- Per-user limits prevent abuse
- Tenant-wide limits ensure fair usage
- Automatic retry with backoff

### Multi-Tenant Architecture

- Complete isolation between tenants
- Secure API key storage
- Role-based access control

### Real-time Features

- Streaming chat responses
- Live voice transcription
- Real-time file processing updates

## API Access

For developers, the platform provides a comprehensive REST API:

```bash
# Get configurations
curl -H "Authorization: Bearer <token>" \
     http://localhost:3001/api/tenant/config

# Create configuration
curl -X POST \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{"provider":"openai","api_key":"sk-..."}' \
     http://localhost:3001/api/tenant/config
```

See the [API Documentation](./API.md) for complete reference.
