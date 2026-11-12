import { describe, expect, it } from 'vitest';

import { avatarThumbnailUrl, profilePictureUrl } from '../src/public-api-routes.js';

// Found live: a consumer got pictures for ~3 of 100+ users while the app showed one for every friend. The app's
// userImage() reads more fields (iconUrl, thumbnailUrl, the avatar thumbnail) than the API used to.
describe('public API picture selection', () => {
    it('keeps the original preference order for the original fields', () => {
        expect(
            profilePictureUrl({
                profilePicOverride: 'override',
                currentAvatarImageUrl: 'avatar',
                userIcon: 'icon',
                imageUrl: 'image'
            })
        ).toBe('override');
        expect(profilePictureUrl({ currentAvatarImageUrl: 'avatar', userIcon: 'icon', imageUrl: 'image' })).toBe(
            'avatar'
        );
        expect(profilePictureUrl({ userIcon: 'icon', imageUrl: 'image' })).toBe('icon');
    });

    it.each([
        ['imageUrl', { imageUrl: 'x' }],
        ['iconUrl', { iconUrl: 'x' }],
        ['thumbnailUrl', { thumbnailUrl: 'x' }],
        ['profilePicOverrideThumbnail', { profilePicOverrideThumbnail: 'x' }],
        ['currentAvatarThumbnailImageUrl', { currentAvatarThumbnailImageUrl: 'x' }]
    ])('falls back to %s when nothing earlier is set', (_name, user) => {
        expect(profilePictureUrl(user)).toBe('x');
    });

    it('is empty only when the cache has no image field at all', () => {
        expect(profilePictureUrl({ id: 'usr_x', displayName: 'X' })).toBe('');
        expect(profilePictureUrl({ imageUrl: '', iconUrl: '', thumbnailUrl: '' })).toBe('');
    });

    it('picks the thumbnail from the thumbnail-ish fields, then the image', () => {
        expect(avatarThumbnailUrl({ currentAvatarThumbnailImageUrl: 'a', thumbnailUrl: 'b' })).toBe('a');
        expect(avatarThumbnailUrl({ profilePicOverrideThumbnail: 'c', imageUrl: 'd' })).toBe('c');
        expect(avatarThumbnailUrl({ imageUrl: 'd' })).toBe('d');
        expect(avatarThumbnailUrl({})).toBe('');
    });
});
