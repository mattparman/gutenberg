/**
 * External dependencies
 */
import { groupBy, isEqual, difference, omit } from 'lodash';

/**
 * WordPress dependencies
 */
import { createBlock } from '@wordpress/blocks';
import { useSelect, useDispatch } from '@wordpress/data';
import { useState, useRef, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';

function createBlockFromMenuItem( menuItem, innerBlocks = [] ) {
	return createBlock(
		'core/navigation-link',
		{
			label: menuItem.title.rendered,
			url: menuItem.url,
		},
		innerBlocks
	);
}

function createMenuItemAttributesFromBlock( block ) {
	return {
		title: block.attributes.label,
		url: block.attributes.url,
	};
}

const flatten = ( recursiveArray, childrenKey ) =>
	recursiveArray.flatMap( ( item ) =>
		[ item ].concat( flatten( item[ childrenKey ] || [], childrenKey ) )
	);

export default function useNavigationBlocks( menuId ) {
	// menuItems is an array of menu item objects.
	const menuItems = useSelect(
		( select ) =>
			select( 'core' ).getMenuItems( { menus: menuId, per_page: -1 } ),
		[ menuId ]
	);

	const { receiveEntityRecords, saveMenuItem } = useDispatch( 'core' );

	// Here be dragons - this is a pretty messy POC, it needs a ton of cleanup and improvements
	// before it will even be close to being mergeable
	const [ blocks, setBlocks ] = useState( [] );
	const [ flatBlocks, setFlatBlocks ] = useState( [] );

	const updateBlocks = ( newBlocks ) => {
		const flatNewBlocks = flatten(
			newBlocks[ 0 ]?.innerBlocks,
			'innerBlocks'
		);
		const added = flatNewBlocks.filter(
			( a ) => ! flatBlocks.find( ( b ) => b.clientId === a.clientId )
		);
		const fullData = flatten(
			prepareRequestData( newBlocks[ 0 ].innerBlocks, 0 ),
			'children'
		);
		added.forEach( ( block ) => {
			const data = fullData.filter(
				( entry ) => entry.clientId === block.clientId
			)[ 0 ];
			if ( ! data || data.id ) {
				return;
			}
			delete data.menus;
			if ( ! data.title ) {
				data.title = 'Placeholder';
			}
			if ( ! data.url ) {
				data.url = 'Placeholder';
			}
			apiFetch( {
				path: `/__experimental/menu-items`,
				method: 'POST',
				data,
			} ).then( ( createdItem ) => {
				menuItemsRef.current[ block.clientId ] = createdItem;
			} );
		} );

		setBlocks( newBlocks );
		setFlatBlocks( flatNewBlocks );
	};

	const menuItemsRef = useRef( {} );

	useEffect( () => {
		if ( ! menuItems ) {
			return;
		}

		const itemsByParentID = groupBy( menuItems, 'parent' );

		menuItemsRef.current = {};

		const createMenuItemBlocks = ( items ) => {
			const innerBlocks = [];
			for ( const item of items ) {
				let menuItemInnerBlocks = [];
				if ( itemsByParentID[ item.id ]?.length ) {
					menuItemInnerBlocks = createMenuItemBlocks(
						itemsByParentID[ item.id ]
					);
				}
				const block = createBlockFromMenuItem(
					item,
					menuItemInnerBlocks
				);
				menuItemsRef.current[ block.clientId ] = item;
				innerBlocks.push( block );
			}
			return innerBlocks;
		};

		// createMenuItemBlocks takes an array of top-level menu items and recursively creates all their innerBlocks
		const innerBlocks = createMenuItemBlocks( itemsByParentID[ 0 ] || [] );
		updateBlocks( [ createBlock( 'core/navigation', {}, innerBlocks ) ] );
	}, [ menuItems ] );

	const prepareRequestItem = ( block, parentId ) => {
		const menuItem = omit(
			menuItemsRef.current[ block.clientId ] || {},
			'_links'
		);

		return {
			...menuItem,
			...createMenuItemAttributesFromBlock( block ),
			clientId: block.clientId,
			menus: menuId,
			parent: parentId,
			menu_order: 0,
		};
	};

	const prepareRequestData = ( nestedBlocks, parentId = 0 ) =>
		nestedBlocks.map( ( block ) => {
			const data = prepareRequestItem( block, parentId );
			return {
				...data,
				children: prepareRequestData( block.innerBlocks, data.id ),
			};
		} );

	const saveBlocks = async () => {
		const { clientId, innerBlocks } = blocks[ 0 ];
		const parentItemId = menuItemsRef.current[ clientId ]?.parent;
		const requestData = prepareRequestData( innerBlocks, parentItemId );

		const saved = await apiFetch( {
			path: `/__experimental/menu-items/save-hierarchy?menus=${ menuId }`,
			method: 'PUT',
			data: { tree: requestData },
		} );

		const kind = 'root';
		const name = 'menuItem';
		// receiveEntityRecords(
		// 	kind,
		// 	name,
		// 	saved,
		// 	// {
		// 	// 	...item.data,
		// 	// 	title: { rendered: 'experimental' },
		// 	// },
		// 	undefined,
		// 	true
		// );
	};

	return [ blocks, updateBlocks, saveBlocks ];
}
