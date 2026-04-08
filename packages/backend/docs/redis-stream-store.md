# Redis Stream Store Implementation

## Overview

The chat streaming functionality has been updated to use Redis instead of an in-memory Map for storing stream states. This enables:

1. **Multi-instance support**: Streams can be resumed across different server instances
2. **Automatic cleanup**: Redis TTL automatically removes old streams
3. **Persistence**: Stream states survive server restarts (within TTL)
4. **Scalability**: Redis can handle high volumes of concurrent streams

## Architecture

### Key Components

1. **Stream Store Module** (`src/redis/stream-store.ts`)
   - Provides Redis-based CRUD operations for stream states
   - Handles serialization/deserialization of stream data
   - Manages TTL (Time-To-Live) for automatic cleanup

2. **Updated Chat Endpoint** (`src/chat/index.ts`)
   - Uses Redis store instead of in-memory Map
   - Maintains same API interface
   - Adds proper error handling for Redis operations

### Data Structure

Stream states are stored in Redis with the following key pattern:

```
chat_stream:{streamId}
```

Each stream state contains:

```typescript
interface StreamState {
  id: string; // Unique stream identifier
  messages: ChatMessage[]; // Conversation history
  options?: ChatOptions; // AI model configuration
  chunks: string[]; // Streamed content chunks
  finished: boolean; // Whether stream is complete
  error?: string; // Error message if failed
  createdAt: number; // Timestamp for cleanup
}
```

## Configuration

### Redis Connection

The Redis client is configured via environment variable:

```bash
REDIS_URL=redis://localhost:6379
```

### TTL Settings

Streams have a TTL of 5 minutes (300 seconds), which:

- Allows sufficient time for reconnects
- Automatically cleans up abandoned streams
- Can be adjusted via `STREAM_TTL_SECONDS` in the stream store module

## Migration from In-Memory Map

### Changes Made

1. **Removed**: In-memory `Map<string, StreamState>`
2. **Added**: Redis-based operations:
   - `storeStreamState()` - Create/update stream
   - `getStreamState()` - Retrieve stream
   - `updateStreamState()` - Partial updates
   - `deleteStreamState()` - Remove stream
   - `addStreamChunk()` - Append content chunks
   - `markStreamFinished()` - Mark as complete/error

3. **Updated**: Cleanup interval now uses Redis TTL instead of manual cleanup

### Benefits

1. **Production Ready**: Works with multiple server instances
2. **Resilient**: Survives server restarts within TTL
3. **Scalable**: Redis can handle high concurrency
4. **Maintainable**: Clear separation of concerns

## Usage Example

```typescript
// Store a new stream
const streamState: StreamState = {
  id: 'stream-123',
  messages: [{ role: 'user', content: 'Hello' }],
  chunks: [],
  finished: false,
  createdAt: Date.now(),
};
await storeStreamState(streamState);

// Add chunks as they arrive
await addStreamChunk('stream-123', 'Hello ');
await addStreamChunk('stream-123', 'world!');

// Mark as finished
await markStreamFinished('stream-123');

// Retrieve for reconnect
const state = await getStreamState('stream-123');
```

## Testing

The implementation includes comprehensive tests:

- Unit tests for Redis operations
- Integration tests for chat endpoints
- Mock Redis client for isolated testing

## Monitoring

### Redis Metrics

- Key count: `chat_stream:*` patterns
- Memory usage: Monitor Redis memory consumption
- Error rates: Track Redis operation failures

### Application Metrics

- Active streams: Count of non-expired stream keys
- Reconnect rate: Successful stream resumptions
- Error rate: Failed stream operations

## Future Enhancements

1. **Compression**: Compress stream data before storing in Redis
2. **Partitioning**: Shard streams across multiple Redis instances
3. **Analytics**: Track stream metrics for optimization
4. **Backup**: Periodic backup of active streams
5. **Migration Tool**: Convert in-memory streams to Redis

## Troubleshooting

### Common Issues

1. **Redis Connection Failed**
   - Check `REDIS_URL` environment variable
   - Verify Redis server is running
   - Check network connectivity

2. **Stream Not Found on Reconnect**
   - Verify TTL hasn't expired
   - Check stream ID matches original
   - Ensure Redis persistence is configured

3. **High Memory Usage**
   - Reduce TTL for streams
   - Implement stream compression
   - Scale Redis memory or use clustering

### Debugging

Enable debug logging for Redis operations:

```typescript
// In development, add logging to stream store operations
console.log('Redis operation:', { key, data: JSON.stringify(data) });
```

## Conclusion

The Redis stream store implementation provides a production-ready solution for managing chat streams across multiple server instances. It maintains backward compatibility while adding scalability and resilience features essential for production deployments.
