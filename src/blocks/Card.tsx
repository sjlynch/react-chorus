import React from 'react';
import type { BlockDefinition, BlockRenderProps } from './types';

export interface CardProps {
  title?: string;
  description?: string;
  body?: React.ReactNode;
  footer?: React.ReactNode;
}

export function Card({ title, description, body, footer }: BlockRenderProps<CardProps> & CardProps) {
  return (
    <div className="chorus-block-card">
      {title && <div className="chorus-block-card-title">{title}</div>}
      {description && <div className="chorus-block-card-description">{description}</div>}
      {body !== undefined && <div className="chorus-block-card-body">{body}</div>}
      {footer !== undefined && <div className="chorus-block-card-footer">{footer}</div>}
    </div>
  );
}

export const CardBlock: BlockDefinition<CardProps> = {
  component: Card,
};
