import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ImagePreviewOverlay, { ImagePreviewFrame } from '../ImagePreviewOverlay';

describe('ImagePreviewOverlay', () => {
  it('renders the reusable preview frame with optional actions', () => {
    const { container } = render(
      <ImagePreviewFrame src="ftlocalfile:///tmp/Figure.png" alt="Figure" label="figure A">
        <button type="button">copy</button>
      </ImagePreviewFrame>,
    );

    const image = container.querySelector('[data-ft-image-preview-img="true"]') as HTMLImageElement | null;
    expect(image?.getAttribute('src')).toBe('ftlocalfile:///tmp/Figure.png');
    expect(image?.getAttribute('alt')).toBe('Figure');
    expect(screen.getByText('figure A')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'copy' })).toBeTruthy();
  });

  it('dismisses when clicking the overlay background', () => {
    const onDismiss = vi.fn();
    const { container } = render(
      <ImagePreviewOverlay src="ftlocalfile:///tmp/Figure.png" alt="Figure" onDismiss={onDismiss} />,
    );

    fireEvent.click(container.querySelector('[data-ft-image-preview-overlay="true"]')!);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
